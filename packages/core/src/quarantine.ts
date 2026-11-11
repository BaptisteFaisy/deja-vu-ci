/**
 * Quarantine proposal (CI-19, § 25 "Quarantaine proposée").
 *
 * For an expensive flaky test, the app drafts the change that isolates it and
 * the ticket that commits somebody to fixing it. It is a **proposal**: nothing
 * is written to a repository (§ 6 puts modifying the repository out of scope)
 * and no ticket is created here — the caller decides.
 *
 * The flakiness verdict is never recomputed: `assessFlakiness` (§ 10.1) stays
 * the single authority, and a test that is not flaky gets no proposal at all.
 */

import { computeCost } from './cost.js';
import { assessFlakiness } from './flaky.js';
import type {
  Occurrence,
  Settings,
  Signature,
  SignatureCost,
  TestStats,
} from './types.js';

/** Test ecosystems whose quarantine syntax the proposal knows. */
export type Ecosystem = 'junit' | 'pytest' | 'jest' | 'go' | 'unknown';

/** The code change that isolates the test, per ecosystem. */
export interface QuarantinePatch {
  ecosystem: Ecosystem;
  /** File the change belongs to, when the stack gives one. */
  file: string;
  /** Where to put it, in plain words. */
  instruction: string;
  /** Copy-pasteable snippet. */
  snippet: string;
}

/** The ticket that commits somebody to repair the quarantined test. */
export interface QuarantineTicket {
  summary: string;
  description: string;
  labels: string[];
  assignee?: string;
  /** Days given to repair before the quarantine is escalated. */
  dueInDays: number;
}

/** What the proposal costs and why it is worth it. */
export interface QuarantineCost {
  occurrences: number;
  branches: number;
  ciMinutesLost: number;
  flakyIndex: number;
}

export interface QuarantineProposal {
  testName: string;
  reason: string;
  cost: QuarantineCost;
  patch: QuarantinePatch;
  ticket: QuarantineTicket;
  /** True when the cost is high enough to be worth showing (§ 25). */
  worthIt: boolean;
}

/** Thresholds behind `worthIt` — documented here, not scattered in the code. */
export const WORTH_IT = {
  ciMinutesLost: 30,
  flakyIndex: 0.5,
  occurrences: 10,
} as const;

/** Days given to repair a quarantined test before escalation. */
export const QUARANTINE_DUE_DAYS = 14;

/** Labels of the proposal ticket (`test-instable` is the label of § 8.2). */
export const QUARANTINE_LABELS = ['test-instable', 'quarantine-proposed'];

/** Input of the proposal. */
export interface QuarantineInput {
  signature: Signature;
  occurrences: Occurrence[];
  stats?: TestStats;
  cost?: SignatureCost;
  now?: Date;
  settings?: Partial<Settings>;
}

/**
 * Ecosystem of a failing test, from its name and the step that ran it.
 *
 * Names are the strongest clue (`Class#method` for JUnit, `file::test` for
 * pytest, `suite > test` for Jest, `TestXxx` for Go); the step name breaks ties.
 */
export function detectEcosystem(testName: string, stepName?: string): Ecosystem {
  const name = testName ?? '';
  const step = (stepName ?? '').toLowerCase();
  if (name.includes('#') || /gradle|maven|junit/i.test(step)) return 'junit';
  if (name.includes('::') || /pytest|py\.test/i.test(step)) return 'pytest';
  if (name.includes('>') || /\bjest\b|mocha|vitest/i.test(step)) return 'jest';
  if (/^Test[A-Z_]/.test(name) || /\bgo test\b/i.test(step)) return 'go';
  return 'unknown';
}

/** Short name of the test, without its class or file prefix. */
function shortTestName(testName: string): string {
  const afterHash = testName.split('#').pop() ?? testName;
  const afterColon = afterHash.split('::').pop() ?? afterHash;
  const afterArrow = afterColon.split('>').pop() ?? afterColon;
  return afterArrow.trim() || testName;
}

/** The file the quarantine should be written in, from the signature stack. */
function fileOf(signature: Signature, occurrences: Occurrence[]): string {
  const frame = signature.frames.find((f) => f.isProject) ?? signature.frames[0];
  if (frame?.file) return frame.file;
  const changed = occurrences.flatMap((o) => o.changedFiles ?? []);
  return changed[0] ?? 'fichier inconnu';
}

/** Author who sees the failure most often: the natural owner of the repair. */
function suggestOwner(occurrences: Occurrence[]): string | undefined {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (!occurrence.author) continue;
    counts.set(occurrence.author, (counts.get(occurrence.author) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [author, count] of counts) {
    if (count > bestCount) {
      best = author;
      bestCount = count;
    }
  }
  return best;
}

/** The isolating change, idiomatic per ecosystem. */
export function quarantinePatch(
  ecosystem: Ecosystem,
  testName: string,
  file: string,
  reason: string,
): QuarantinePatch {
  const short = shortTestName(testName);
  const snippets: Record<Ecosystem, { instruction: string; snippet: string }> = {
    junit: {
      instruction: `Annoter la méthode \`${short}\` dans \`${file}\` (import org.junit.jupiter.api.Disabled).`,
      snippet: `@Disabled("${reason}")\n@Test\nvoid ${short}() { … }`,
    },
    pytest: {
      instruction: `Annoter \`${short}\` dans \`${file}\` (pytest marqué non bloquant, strict=False).`,
      snippet: `@pytest.mark.xfail(reason="${reason}", strict=False)\ndef ${short}():\n    …`,
    },
    jest: {
      instruction: `Passer \`${short}\` en \`.skip\` dans \`${file}\` — le test reste visible et rouge en cas de réparation.`,
      snippet: `it.skip('${short}', () => {\n  // ${reason}\n});`,
    },
    go: {
      instruction: `Ajouter un \`t.Skip\` en tête de \`${short}\` dans \`${file}\`.`,
      snippet: `func ${short}(t *testing.T) {\n\tt.Skip("${reason}")\n\t…\n}`,
    },
    unknown: {
      instruction: `Isoler \`${short}\` (mécanisme propre à l'outillage du dépôt) et ouvrir le ticket de réparation.`,
      snippet: `# ${short} — quarantaine proposée : ${reason}`,
    },
  };
  const chosen = snippets[ecosystem];
  return { ecosystem, file, instruction: chosen.instruction, snippet: chosen.snippet };
}

/** Cost of the flaky test, from the caller's figures or recomputed here. */
function costOf(input: QuarantineInput, flakyIndex: number, branches: number): QuarantineCost {
  const provided = input.cost;
  if (provided) {
    return {
      occurrences: provided.occurrences,
      branches,
      ciMinutesLost: provided.ciMinutesLost,
      flakyIndex,
    };
  }
  const report = computeCost(input.occurrences, {
    signatures: [input.signature],
    now: input.now,
  });
  const detail = report.perSignature.find((c) => c.signatureId === input.signature.id);
  return {
    occurrences: detail?.occurrences ?? report.redBuilds,
    branches,
    ciMinutesLost: detail?.ciMinutesLost ?? report.ciMinutesLost,
    flakyIndex,
  };
}

/** True when the cost justifies showing the proposal (§ 25). */
export function isWorthIt(cost: QuarantineCost): boolean {
  return (
    cost.ciMinutesLost >= WORTH_IT.ciMinutesLost ||
    cost.flakyIndex >= WORTH_IT.flakyIndex ||
    cost.occurrences >= WORTH_IT.occurrences
  );
}

/** The ticket that commits somebody to repair the quarantined test. */
function ticketFor(testName: string, cost: QuarantineCost, owner?: string): QuarantineTicket {
  const summary = `[CI] Repair quarantined test ${shortTestName(testName)}`;
  const lines = [
    `h1. Pourquoi la quarantaine`,
    `${cost.occurrences} échecs sur ${cost.branches} branches, ${cost.ciMinutesLost} minutes de CI perdues, ` +
      `indice d'instabilité ${cost.flakyIndex.toFixed(2)}.`,
    '',
    'h1. Ce qui est attendu',
    `* réparer le test, ou le supprimer s'il ne protège plus rien ;`,
    `* retirer la quarantaine dans le même changement ;`,
    `* échéance : ${QUARANTINE_DUE_DAYS} jours — au-delà, la quarantaine est remontée.`,
  ];
  if (owner) lines.push('', `Propriétaire suggéré : ${owner} (auteur le plus fréquent des échecs).`);
  return {
    summary,
    description: lines.join('\n'),
    labels: [...QUARANTINE_LABELS],
    ...(owner ? { assignee: owner } : {}),
    dueInDays: QUARANTINE_DUE_DAYS,
  };
}

/**
 * Draft the quarantine of a flaky test, or nothing when it is not flaky.
 *
 * The verdict comes from `assessFlakiness`; a genuinely broken test (many
 * failures, no success at the same commit) never gets a proposal — quarantining
 * it would hide a real defect (§ 19).
 */
export function proposeQuarantine(input: QuarantineInput): QuarantineProposal | undefined {
  const verdict = assessFlakiness(input.occurrences, {
    settings: input.settings,
    now: input.now,
  });
  if (!verdict.flaky) return undefined;

  const testName =
    input.signature.testName ??
    input.occurrences.find((o) => o.testName)?.testName ??
    input.signature.template;
  const flakyIndex = input.stats?.flakyIndex ?? verdict.flakyIndex;
  const cost = costOf(input, flakyIndex, verdict.branches);
  const reason = `flaky: ${cost.occurrences} failures on ${cost.branches} branches, ${cost.ciMinutesLost} min of CI lost`;
  const file = fileOf(input.signature, input.occurrences);
  const ecosystem = detectEcosystem(
    testName,
    input.occurrences[0]?.stepName,
  );
  const owner = suggestOwner(input.occurrences);

  return {
    testName,
    reason,
    cost,
    patch: quarantinePatch(ecosystem, testName, file, reason),
    ticket: ticketFor(testName, cost, owner),
    worthIt: isWorthIt(cost),
  };
}
