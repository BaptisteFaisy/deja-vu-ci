/**
 * Recette d'acceptation du cahier des charges (§ 20), jouée de bout en bout
 * sur le vrai moteur — extraction, signature, diagnostic, tickets — via un
 * rejeu déterministe. Chaque `it` est un point de la recette, numéroté.
 *
 * Les points 8 (`explain-build-failure` identique à la carte de PR) et 9 (le
 * jeu d'exemple complet) vivent respectivement dans `apps/brain/test` et dans
 * `tools/replay.mjs` : ils dépendent des actions Rovo et du jeu livré en data.
 */

import { describe, expect, it } from 'vitest';
import { extractErrorBlocks } from '../src/extract.js';
import { maskSecrets } from '../src/mask.js';
import { replay } from '../src/replay.js';
import { signatureOf } from '../src/sign.js';
import { planTicketActions } from '../src/tickets.js';
import type { Diagnostic, Occurrence, SampleDataset, SampleOccurrence, Signature } from '../src/types.js';

const DAY_MS = 86_400_000;
const T0 = Date.parse('2026-11-01T09:00:00Z');

/** ISO date of a day of the fixture, plus an offset in minutes. */
function at(day: number, minute = 0): string {
  return new Date(T0 + day * DAY_MS + minute * 60_000).toISOString();
}

const FLAKY_TEST = 'com.acme.PaymentTest#testPaymentRetry';
const FIX_COMMIT = 'abc123def456';

/** A failing run of the unstable test; only the line number moves. */
function flakyFailure(day: number, minute: number, branch: string, commit: string, line: number): SampleOccurrence {
  return {
    at: at(day, minute),
    repo: 'payments-api',
    branch,
    commit,
    author: 'dev',
    step: 'unit-tests',
    durationS: 45,
    outcome: 'failure',
    log: `[INFO] Running com.acme.PaymentTest\n[ERROR] Tests run: 12, Failures: 1, Errors: 0, Time elapsed: 3.${line} s`,
    testCases: [
      {
        name: FLAKY_TEST,
        message: 'expected: <200> but was: <500>',
        stack: `at com.acme.PaymentTest.testPaymentRetry(PaymentTest.java:${line})`,
      },
    ],
    expected: { diagnostic: 'flaky', testName: FLAKY_TEST },
  };
}

/** A green run of the same step at the same commit (the flakiness proof). */
function sameCommitSuccess(day: number, minute: number, branch: string, commit: string): SampleOccurrence {
  return {
    at: at(day, minute),
    repo: 'payments-api',
    branch,
    commit,
    author: 'ci-retry',
    step: 'unit-tests',
    durationS: 42,
    outcome: 'success',
  };
}

const CLIENT_ERROR = `TypeError: Cannot read properties of undefined (reading 'token')
    at HttpClient.refreshToken (src/payments/client.ts:88:12)
    at PaymentService.charge (src/payments/service.ts:42:10)`;

const NEW_ERROR = `AssertionError: refund limit exceeded
    at Limiter.apply (src/refund/Limiter.ts:57:12)
    at RefundService.charge (src/refund/service.ts:88:5)`;

const REGISTRY_ERROR = `npm ERR! code ECONNREFUSED
npm ERR! network request to https://registry.npmjs.org/@acme/core failed
npm ERR! A complete log can be found in: /root/.npm/_logs/debug.log`;

/** Failure of the fixed error, on a branch that may or may not contain the fix. */
function clientFailure(day: number, branch: string, commit: string, contains: string[]): SampleOccurrence {
  return {
    at: at(day, 10),
    repo: 'payments-api',
    branch,
    commit,
    author: 'dev-x',
    step: 'integration-tests',
    durationS: 90,
    outcome: 'failure',
    log: CLIENT_ERROR,
    containsCommits: contains,
  };
}

/** The fixture: 10 runs of the unstable test, a fix, a regression, a new error, an outage. */
function fixture(): SampleDataset {
  const occurrences: SampleOccurrence[] = [];
  const branches = ['feature/pay-1', 'feature/pay-2', 'feature/pay-3'];

  // Unstable test: three branches, each failing then passing at the same commit.
  branches.forEach((branch, index) => {
    const commit = `c0ffee0${index}`;
    occurrences.push(flakyFailure(index, 0, branch, commit, 41 + index * 8));
    occurrences.push(sameCommitSuccess(index, 5, branch, commit));
  });

  // The fix: the client error fails on main, then passes at the fixing commit.
  occurrences.push(clientFailure(1, 'main', 'c0ffee10', []));
  occurrences.push({
    at: at(1, 60),
    repo: 'payments-api',
    branch: 'main',
    commit: FIX_COMMIT,
    author: 'marie',
    step: 'integration-tests',
    durationS: 88,
    outcome: 'success',
  });

  // Seven more runs of the unstable test, up to ten occurrences; day 4 gets a
  // second one, two hours later, to exercise the one-comment-per-day rule.
  for (let i = 3; i < 10; i += 1) {
    occurrences.push(flakyFailure(i, 0, branches[i % branches.length], `c0ffee1${i}`, 41 + i));
    if (i === 4) {
      occurrences.push(
        flakyFailure(i, 300, branches[(i + 1) % branches.length], `c0ffee1${i}b`, 55),
      );
    }
  }

  // Package registry down.
  occurrences.push({
    at: at(11, 0),
    repo: 'payments-api',
    branch: 'feature/registry-down',
    commit: 'c0ffee20',
    author: 'dev-y',
    step: 'install-dependencies',
    durationS: 15,
    outcome: 'failure',
    log: REGISTRY_ERROR,
    expected: { diagnostic: 'infrastructure' },
  });

  // A brand new error, whose suspect file is in the pull request.
  occurrences.push({
    at: at(10, 0),
    repo: 'payments-api',
    branch: 'feature/refund-limit',
    commit: 'c0ffee21',
    author: 'dev-z',
    step: 'unit-tests',
    durationS: 30,
    outcome: 'failure',
    log: NEW_ERROR,
    changedFiles: ['src/refund/Limiter.ts', 'src/refund/service.ts'],
    expected: { diagnostic: 'new' },
  });

  // The fixed error on a branch that predates the fix, then on main again.
  occurrences.push(clientFailure(9, 'feature/legacy-branch', 'c0ffee22', []));
  occurrences.push(clientFailure(12, 'main', 'c0ffee23', [FIX_COMMIT]));

  return {
    name: 'recette-20',
    description: 'Acceptance recipe of § 20, replayed without Bitbucket.',
    repository: 'payments-api',
    days: 14,
    occurrences,
    resolutions: [
      {
        match: { contains: "Cannot read properties of undefined (reading 'token')" },
        commit: FIX_COMMIT,
        author: 'marie',
        note: 'HTTP client refreshed on token expiry',
        files: ['src/payments/client.ts'],
        confirmed: true,
      },
    ],
  };
}

/** The signature of the unstable test in a replay result. */
function signatureOfTest(result: Awaited<ReturnType<typeof replay>>, testName: string): Signature | undefined {
  return result.signatures.find((s) => s.testName === testName);
}

/** The diagnostic produced for one occurrence, found by its commit. */
function diagnosticFor(result: Awaited<ReturnType<typeof replay>>, commit: string): Diagnostic | undefined {
  return result.diagnostics.find((d) => d.occurrence.commit === commit)?.diagnostic;
}

/** Occurrences of a signature, in chronological order. */
function occurrencesOf(result: Awaited<ReturnType<typeof replay>>, signatureId: string): Occurrence[] {
  return result.diagnostics
    .filter((d) => d.occurrence.signatureId === signatureId)
    .map((d) => d.occurrence)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
}

describe('recette § 20 — acceptation de bout en bout', () => {
  it('1. deux échecs qui ne diffèrent que par horodatage et numéro de ligne ont la même signature', () => {
    const first = extractErrorBlocks({
      stepLog: `[2026-11-01 09:00:01] ERROR build failed\n${CLIENT_ERROR}`,
    });
    const second = extractErrorBlocks({
      stepLog: `[2026-11-04 17:42:09] ERROR build failed\n${CLIENT_ERROR.replace(':88:', ':91:')}`,
    });
    expect(first.blocks).toHaveLength(1);
    expect(second.blocks).toHaveLength(1);
    expect(signatureOf(first.blocks[0])).toBe(signatureOf(second.blocks[0]));
  });

  it('2. échec puis succès au même commit sur trois branches : instable, un seul ticket', async () => {
    const result = await replay(fixture());
    const signature = signatureOfTest(result, FLAKY_TEST);
    expect(signature?.status).toBe('flaky');

    const creations = result.tickets.filter((t) => t.kind === 'create' && t.signatureId === signature?.id);
    expect(creations).toHaveLength(1);
    expect(creations[0].labels).toContain('test-instable');

    const flakyDiagnostics = result.diagnostics.filter((d) => d.diagnostic.kind === 'flaky');
    expect(flakyDiagnostics.length).toBeGreaterThan(0);
    expect(flakyDiagnostics[0].diagnostic.action).toBe('retry');
  });

  it('3. une dixième occurrence met à jour le ticket, sans nouveau ticket ni second commentaire du jour', async () => {
    const dataset = fixture();
    const result = await replay(dataset);
    const signature = signatureOfTest(result, FLAKY_TEST);
    expect(signature).toBeDefined();
    expect(signature?.occurrences).toBeGreaterThanOrEqual(10);

    const familyTickets = result.tickets.filter((t) => t.familyId === signature?.familyId);
    expect(familyTickets.filter((t) => t.kind === 'create')).toHaveLength(1);
    expect(familyTickets.filter((t) => t.kind === 'update').length).toBeGreaterThan(0);

    // Le jour 4 porte deux occurrences : la seconde ne doit pas ajouter de
    // commentaire. Preuve différentielle : on rejoue sans elle et le nombre de
    // commentaires de la famille ne change pas.
    const occurrences = occurrencesOf(result, signature!.id);
    const day = at(4).slice(0, 10);
    const sameDay = occurrences.filter((o) => o.occurredAt.startsWith(day));
    expect(sameDay).toHaveLength(2);

    const lighter = withoutOccurrence(dataset, sameDay[1]);
    const lighterResult = await replay(lighter);
    expect(countComments(result, signature!.familyId)).toBe(
      countComments(lighterResult, signature!.familyId),
    );
    expect(countComments(result, signature!.familyId)).toBeGreaterThan(0);
  });

  it('4. une erreur jamais vue est « nouveau » et cite les fichiers modifiés de la pile', async () => {
    const result = await replay(fixture());
    const diagnostic = diagnosticFor(result, 'c0ffee21');
    expect(diagnostic?.kind).toBe('new');
    expect(diagnostic?.suspects).toContain('src/refund/Limiter.ts');
    expect(diagnostic?.action).toBe('fix');
  });

  it('5. une erreur de téléchargement de paquet est « infrastructure »', async () => {
    const result = await replay(fixture());
    const diagnostic = diagnosticFor(result, 'c0ffee20');
    expect(diagnostic?.kind).toBe('infrastructure');
    expect(diagnostic?.action).toBe('wait');
  });

  it('6. une signature résolue qui réapparaît passe en régression et rouvre son ticket', async () => {
    const result = await replay(fixture());
    const signature = result.signatures.find((s) => s.template.includes("reading 'token'"));
    expect(signature).toBeDefined();
    expect(signature?.status).toBe('regression');

    const occurrences = occurrencesOf(result, signature!.id);
    const plan = planTicketActions({
      signature: signature!,
      occurrences,
      existingIssueKey: 'CI-42',
      now: new Date(occurrences[occurrences.length - 1].occurredAt),
    });
    expect(plan.map((a) => a.kind)).toContain('reopen');

    // La branche qui précède le correctif reçoit « déjà corrigé », pas une régression.
    const legacy = diagnosticFor(result, 'c0ffee22');
    expect(legacy?.kind).toBe('already-fixed');
    expect(legacy?.resolution?.commit).toBe(FIX_COMMIT);
    expect(legacy?.resolution?.author).toBe('marie');
  });

  it('7. un extrait contenant un jeton arrive masqué côté Cerveau', () => {
    const leaked = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjaS1ib3QifQ.c2lnbmF0dXJlLWRlLXRlc3Q',
      'connecting to postgres://ci:hunter2secret@db.internal:5432/payments',
      'reported by marie.dupont@example.com',
    ].join('\n');
    const masked = maskSecrets(leaked);
    expect(masked.masked).toBeGreaterThanOrEqual(3);
    expect(masked.text).not.toContain('hunter2secret');
    expect(masked.text).not.toContain('marie.dupont@example.com');
    expect(masked.text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    // Idempotent : masquer deux fois ne change plus rien.
    expect(maskSecrets(masked.text).masked).toBe(0);

    // Et le moteur masque aussi ce qui passe par l'extraction.
    const blocks = extractErrorBlocks({ stepLog: `${leaked}\n${CLIENT_ERROR}` });
    expect(blocks.blocks.every((b) => !b.rawText.includes('hunter2secret'))).toBe(true);
  });

  it('9. le rejeu produit les quatre diagnostics, sans Bitbucket', async () => {
    const result = await replay(fixture());
    expect(result.byKind.flaky).toBeGreaterThan(0);
    expect(result.byKind['already-fixed']).toBeGreaterThan(0);
    expect(result.byKind.new).toBeGreaterThan(0);
    expect(result.byKind.infrastructure).toBeGreaterThan(0);
    expect(result.occurrences).toBe(result.diagnostics.length);
  });
});

/** Number of synthesis comments planned for one family during a replay. */
function countComments(result: Awaited<ReturnType<typeof replay>>, familyId: string): number {
  return result.tickets.filter((t) => t.familyId === familyId && t.kind === 'comment').length;
}

/** The same dataset without one occurrence (matched by commit and instant). */
function withoutOccurrence(dataset: SampleDataset, dropped: Occurrence): SampleDataset {
  return {
    ...dataset,
    occurrences: dataset.occurrences.filter(
      (o) => !(o.commit === dropped.commit && o.at === dropped.occurredAt),
    ),
  };
}
