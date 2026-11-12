/**
 * The "Jira screens" panel: every view model comes from the product's code.
 *
 * These tests replay the sample set in the shared workshop, then assert what
 * the panel shows: the rows of the project page (with their filters and their
 * sort), the text of the issue panel, the six panels added this week and the
 * settings schema. Nothing here is a snapshot of hand-written numbers: each
 * expectation is a property of the real view model.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, type Workspace } from '../src/state/workspace';
import { NO_KNOWN_FAILURE } from '../../apps/brain/src/pure/issueContextText';
import { MEMORY_TABLES } from '../../apps/brain/src/pure/memoryHealth';
import { DEFAULT_SETTINGS } from '../../apps/brain/src/pure/defaults';
import { CSV_HEADER } from '../../apps/brain/src/pure/exportMemory';
import {
  issueChoices,
  issueData,
  pageData,
  settingsData,
  visibleRows,
  weeklyData,
  windowDays,
  type JiraSource,
  type PageQuery,
} from '../src/panels/jira-donnees';
import { panel } from '../src/panels/jira';

let workspace: Workspace;
let source: JiraSource;

const QUERY: PageQuery = { text: '', sortKey: 'lastSeen' };

beforeAll(async () => {
  workspace = await createWorkspace();
  source = { store: workspace.store, result: workspace.result, now: workspace.now };
});

describe('panel contract', () => {
  it('keeps the id the registry expects, with a title and a summary', () => {
    expect(panel.id).toBe('jira');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(3);
      expect(panel.summary(lang).length).toBeGreaterThan(20);
    }
  });
});

describe('project page', () => {
  it('builds one row per signature of the memory', async () => {
    const page = await pageData(source, QUERY, 'en');
    const signatures = await source.store.listSignatures();
    expect(page.allRows.length).toBe(signatures.length);
    expect(page.allRows.length).toBeGreaterThan(0);
    expect(page.rows.length).toBe(page.allRows.length);
  });

  it('labels every row with the shared words of the product', async () => {
    const page = await pageData(source, QUERY, 'fr');
    for (const row of page.allRows) {
      expect(row.shortId).toMatch(/^S-\d+$/);
      expect(row.badge.label.length).toBeGreaterThan(0);
      expect(row.categoryLabel.length).toBeGreaterThan(0);
    }
  });

  it('filters on the free text and on the status', async () => {
    const page = await pageData(source, QUERY, 'en');
    const nothing = visibleRows(page.allRows, { ...QUERY, text: 'zzz-no-such-text' });
    expect(nothing.length).toBe(0);

    const status = page.allRows[0].status;
    const filtered = visibleRows(page.allRows, { ...QUERY, status });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((row) => row.status === status)).toBe(true);
  });

  it('sorts by occurrences, most expensive first', async () => {
    const page = await pageData(source, QUERY, 'en');
    const sorted = visibleRows(page.allRows, { ...QUERY, sortKey: 'occurrences' });
    const counts = sorted.map((row) => row.occurrences);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('prices the page over the window of the sample set', async () => {
    const page = await pageData(source, QUERY, 'en');
    expect(page.windowDays).toBe(windowDays());
    expect(page.costRows.length).toBeGreaterThan(0);
    expect(page.report.redBuilds).toBeGreaterThan(0);
    expect(page.report.ciMinutesLost).toBeGreaterThan(0);
  });
});

describe('issue panel', () => {
  it('offers every signature of the memory', async () => {
    const choices = await issueChoices(source, 'en');
    const signatures = await source.store.listSignatures();
    expect(choices.length).toBe(signatures.length);
    expect(choices.every((choice) => choice.label.length > 0)).toBe(true);
  });

  it('writes the text Rovo reads out of the real diagnostic', () => {
    const entries = source.result.diagnostics.filter(
      (entry) => entry.diagnostic.signatureId === source.result.diagnostics[0].diagnostic.signatureId,
    );
    const latest = entries.reduce((a, b) =>
      a.occurrence.occurredAt >= b.occurrence.occurredAt ? a : b,
    );
    const issue = issueData(source, latest.diagnostic.signatureId, 'en');
    expect(issue.occurrences).toBe(entries.length);
    expect(issue.text.length).toBeGreaterThan(20);
    expect(issue.text).not.toBe(NO_KNOWN_FAILURE);
    expect(issue.diagnostic?.kind).toBe(latest.diagnostic.kind);
  });

  it('says so when the memory knows nothing about the signature', () => {
    const issue = issueData(source, 'no-such-signature', 'en');
    expect(issue.text).toBe(NO_KNOWN_FAILURE);
    expect(issue.occurrences).toBe(0);
    expect(issue.diagnostic).toBeUndefined();
  });
});

describe('panels added this week', () => {
  it('finds the infrastructure incident of the sample set', async () => {
    const weekly = await weeklyData(source);
    expect(weekly.incident).toBeDefined();
    expect(weekly.incident?.repos.length).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.outbreakRepos);
    expect(weekly.incident?.occurrences).toBeGreaterThan(0);
    expect(weekly.incident?.windowMinutes).toBe(DEFAULT_SETTINGS.outbreakWindowMin);
  });

  it('draws one point per day of the window', async () => {
    const weekly = await weeklyData(source);
    expect(weekly.trend.windowDays).toBe(windowDays());
    expect(weekly.points.length).toBe(windowDays());
    expect(weekly.points.every((point) => point.bar.length === 12)).toBe(true);
    const minutes = weekly.points.reduce((total, point) => total + point.ciMinutesLost, 0);
    expect(minutes).toBeGreaterThan(0);
  });

  it('estimates the occupancy of every table of the memory', async () => {
    const weekly = await weeklyData(source);
    expect([...weekly.health.tables.map((entry) => entry.table)].sort()).toEqual([...MEMORY_TABLES].sort());
    expect(weekly.health.totalRows).toBeGreaterThan(0);
    expect(weekly.health.estimatedBytes).toBeGreaterThan(0);
    expect(weekly.health.usedRatio).toBeGreaterThan(0);
    expect(weekly.health.usedRatio).toBeLessThan(1);
    expect(weekly.healthRows.signature).toBeGreaterThan(0);
    expect(weekly.healthRows.occurrence).toBe(source.result.diagnostics.length);
  });

  it('writes one journal line per action of the ticket plan', async () => {
    const weekly = await weeklyData(source);
    expect(weekly.audit.length).toBe(source.result.tickets.length);
    expect(weekly.audit.every((line) => line.id.length === 32)).toBe(true);
    expect(weekly.audit.every((line) => line.action.length > 0)).toBe(true);
    const instants = weekly.audit.map((line) => line.createdAt);
    expect(instants).toEqual([...instants].sort().reverse());
  });

  it('exports the memory in both formats', async () => {
    const weekly = await weeklyData(source);
    expect(weekly.exports.map((item) => item.format)).toEqual(['csv', 'json']);
    for (const item of weekly.exports) {
      expect(item.counts.signatures).toBeGreaterThan(0);
      expect(item.counts.occurrences).toBe(source.result.diagnostics.length);
      expect(item.filename).toMatch(new RegExp(`^deja-vu-memory-.+\\.${item.format}$`));
      expect(item.content.length).toBeGreaterThan(0);
    }
    const csv = weekly.exports[0].content.split('\r\n');
    expect(csv[0]).toBe(CSV_HEADER.join(','));
    expect(csv.length).toBeGreaterThan(1 + weekly.exports[0].counts.occurrences);
  });

  it('applies the three retention policies to a real excerpt', async () => {
    const weekly = await weeklyData(source);
    expect(weekly.excerptSource.length).toBeGreaterThan(0);
    expect(weekly.excerpts.map((entry) => entry.policy)).toEqual([
      'hash-only',
      'masked-snippet',
      'full',
    ]);
    const [hashOnly, snippet, full] = weekly.excerpts.map((entry) => entry.result);
    expect(hashOnly.text).toBeUndefined();
    expect(hashOnly.bytes).toBe(0);
    expect(snippet.bytes).toBeGreaterThan(0);
    expect(full.bytes).toBeGreaterThanOrEqual(snippet.bytes);
    expect(new Set([hashOnly.fingerprint, snippet.fingerprint, full.fingerprint]).size).toBe(1);
  });
});

describe('settings', () => {
  it('shows the stored settings and the defaults of the engine', async () => {
    const data = settingsData(await source.store.getSettings());
    expect(data.payload.issueProjectKey).toBe(DEFAULT_SETTINGS.issueProjectKey);
    expect(data.payload.flakyWindowDays).toBe(DEFAULT_SETTINGS.flakyWindowDays);
    expect(data.defaults).toEqual(DEFAULT_SETTINGS);
  });

  it('lets the validator itself state the constraints', () => {
    const data = settingsData(DEFAULT_SETTINGS);
    const byInput = (needle: string) =>
      data.examples.find((example) => JSON.stringify(example.input).includes(needle));

    const project = byInput('issueProjectKey');
    expect(project?.ok).toBe(true);
    expect(JSON.stringify(project?.value)).toContain('CI');

    const tooBig = byInput('flakyWindowDays');
    expect(tooBig?.ok).toBe(false);
    expect(tooBig?.error).toContain('between');

    const coerced = byInput('outbreakWindowMin');
    expect(coerced?.ok).toBe(true);

    const policy = byInput('excerptPolicy');
    expect(policy?.ok).toBe(true);
    expect(policy?.value).toBe('hash-only');
  });
});
