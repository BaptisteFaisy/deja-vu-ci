// Tests of the universal-entry CLI (integrations/cli). The CLI is exercised
// as a real child process against an ephemeral loopback HTTP server — never
// the real network. The server runs in this process, so the child is spawned
// asynchronously (spawnSync would freeze the event loop and starve the server).

import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload } from '../integrations/cli/lib/payload.js';

const BIN = fileURLToPath(new URL('../integrations/cli/bin/deja-vu.js', import.meta.url));

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function tempLog(content = 'build failed\nAssertionError: 1 != 2\n') {
  const dir = mkdtempSync(join(tmpdir(), 'deja-vu-cli-'));
  const file = join(dir, 'build.log');
  writeFileSync(file, content);
  return { dir, file };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ method: req.method, url: req.url, body });
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/universal`, requests });
    });
  });
}

describe('deja-vu report', () => {
  it('builds a deterministic idempotency key over the content', () => {
    const a = buildPayload({ key: 'k', repository: 'o/r', branch: 'main', log: 'boom' });
    const b = buildPayload({ key: 'k', repository: 'o/r', branch: 'main', log: 'boom' });
    const c = buildPayload({ key: 'k', repository: 'o/r', branch: 'main', log: 'other' });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey);
  });

  it('dry-run never touches the network and exits 0', async () => {
    const { dir, file } = tempLog();
    const res = await runCli(['report', '--url', 'http://127.0.0.1:9/x', '--key', 'k', '--repo', 'o/r', '--log', file, '--dry-run', '--json']);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.dryRun).toBe(true);
    expect(out.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('posts the payload to the Brain and reports success', async () => {
    const { dir, file } = tempLog();
    const { server, url, requests } = await startServer((req, res) => {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued: true }));
    });
    try {
      const res = await runCli(['report', '--url', url, '--key', 'k', '--repo', 'o/r', '--log', file, '--timeout', '5000']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('reported');
      expect(requests).toHaveLength(1);
      const sent = JSON.parse(requests[0].body);
      expect(sent.projectKey).toBe('k');
      expect(sent.repository).toBe('o/r');
      expect(sent.log).toContain('AssertionError');
      expect(sent.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retries a transient 503 with the same idempotency key', async () => {
    const { dir, file } = tempLog();
    let hits = 0;
    const { server, url, requests } = await startServer((req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'masking engine unavailable' }));
        return;
      }
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued: true }));
    });
    try {
      const res = await runCli(['report', '--url', url, '--key', 'k', '--repo', 'o/r', '--log', file, '--retries', '2', '--timeout', '5000']);
      expect(res.status).toBe(0);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      const keys = new Set(requests.map((r) => JSON.parse(r.body).idempotencyKey));
      expect(keys.size).toBe(1); // a replay keeps the same key
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a non-zero code on a definitive refusal (not on a red build)', async () => {
    const { dir, file } = tempLog();
    const { server, url } = await startServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid universal key' }));
    });
    try {
      const res = await runCli(['report', '--url', url, '--key', 'k', '--repo', 'o/r', '--log', file, '--timeout', '5000']);
      expect(res.status).toBe(1);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a non-zero code when the Brain is unreachable', async () => {
    const { dir, file } = tempLog();
    const res = await runCli(['report', '--url', 'http://127.0.0.1:9/x', '--key', 'k', '--repo', 'o/r', '--log', file, '--retries', '1', '--timeout', '500']);
    expect(res.status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a missing log with a usage error (exit 2)', async () => {
    const res = await runCli(['report', '--url', 'http://127.0.0.1:9/x', '--key', 'k', '--repo', 'o/r']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('--log');
  });
});