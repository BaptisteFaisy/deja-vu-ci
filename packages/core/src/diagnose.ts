/**
 * Diagnostic engine (§ 5, § 10).
 *
 * Every failing occurrence gets exactly one verdict, evaluated in this order:
 *
 *   1. `infrastructure` — the category says infrastructure/dependency, or an
 *      outbreak (§ 10.3) is on going: the failure is not the developer's.
 *   2. `already-fixed` — a resolution is known and the current branch does not
 *      contain it (§ 10.2): rebase.
 *   3. `flaky` — the signature is provably unstable (§ 10.1): retry.
 *   4. `new` — never seen before, neither the signature nor the family
 *      (§ 10.4): fix, and point at the files of the pull request that appear
 *      in the stack.
 *   5. `uncertain` — everything else. We show the facts and stop there.
 *
 * Prudence (§ 18): a verdict that excuses the pull request is only rendered
 * above `minConfidenceNotYourFault`. Below that line the verdict becomes
 * `uncertain`, keeps its facts, and proposes no action.
 *
 * Confidence scale (documented, § 18 "Prudence"):
 *
 * | Verdict          | Condition                              | Confidence |
 * |------------------|----------------------------------------|------------|
 * | infrastructure   | outbreak on at least 3 repositories    | 0.90       |
 * | infrastructure   | category infrastructure/dependency      | 0.85       |
 * | already-fixed    | confirmed resolution                   | 0.90       |
 * | already-fixed    | candidate resolution                   | 0.75       |
 * | flaky            | >=3 branches and a same-commit success | 0.95       |
 * | flaky            | thresholds just reached                | 0.80       |
 * | new              | stack available                        | 0.85       |
 * | new              | no stack                               | 0.60       |
 * | uncertain        | not enough evidence                    | 0.40       |
 */

import { assessFlakiness, resolveSettings } from './flaky.js';
import type {
  Category,
  Diagnostic,
  DiagnosticFact,
  DiagnosticStats,
  DiagnoseContext,
  ErrorBlock,
  Frame,
  Occurrence,
  Settings,
  Signature,
} from './types.js';

/**
 * Optional hints the caller may know about the failing block. The frozen
 * `DiagnoseContext` carries no category and no stack, yet the rules of § 10.3
 * and § 10.4 need them: the hints are optional, so a plain `DiagnoseContext`
 * stays a valid input.
 */
export interface DiagnoseHints {
  /** Category of the failing block (from the categorizer). */
  category?: Category;
  /** Signature record, when known (frames, error type, status). */
  signature?: Signature;
  /** Raw error text, used to guess the category when it is unknown. */
  errorText?: string;
  /** Stack of the failing block, when the caller already extracted it. */
  frames?: Frame[];
  /** Reference instant for the sliding windows. */
  now?: Date;
}

/** A context enriched with the optional hints. */
export type DiagnoseInput = DiagnoseContext & DiagnoseHints;

/**
 * Build the hints from an extracted error block, so that callers who already
 * ran the categorizer pass the category and the stack without duplicating
 * them.
 */
export function hintsFromBlock(block: ErrorBlock): DiagnoseHints {
  return { category: block.category, frames: block.frames, errorText: block.rawText };
}

const CONFIDENCE = {
  infrastructureOutbreak: 0.9,
  infrastructureCategory: 0.85,
  alreadyFixedConfirmed: 0.9,
  alreadyFixedCandidate: 0.75,
  flakyStrong: 0.95,
  flakyThreshold: 0.8,
  newWithStack: 0.85,
  newWithoutStack: 0.6,
  uncertain: 0.4,
} as const;

/** Verdicts that declare the failure unrelated to the pull request. */
const EXCUSING_KINDS = new Set<Diagnostic['kind']>(['flaky', 'infrastructure']);

const MAX_TITLE_LENGTH = 90;

/** Shared part of every diagnostic built by this module. */
interface DiagnosticBase {
  signatureId: string;
  signatureShort: string;
  stats: DiagnosticStats;
}

/**
 * Produce the diagnostic of one occurrence.
 *
 * The order of evaluation is fixed: infrastructure, already-fixed, flaky, new,
 * uncertain.
 */
export function diagnose(ctx: DiagnoseInput): Diagnostic {
  const input = ctx;
  const settings = resolveSettings(input.settings);
  const now = input.now ?? new Date();
  const pool = poolOccurrences(input);
  const stats = buildStats(pool);
  const category = input.category ?? input.signature?.category ?? guessCategory(input);
  const base: DiagnosticBase = {
    signatureId: input.occurrence.signatureId,
    signatureShort: shortSignatureId(input.occurrence.signatureId),
    stats,
  };

  const infrastructure = diagnoseInfrastructure(input, category, stats, base);
  if (infrastructure) return infrastructure;

  const alreadyFixed = diagnoseAlreadyFixed(input, stats, base);
  if (alreadyFixed) return alreadyFixed;

  const flaky = diagnoseFlaky(input, pool, settings, now, stats, base);
  if (flaky) return flaky;

  const fresh = diagnoseNew(input, stats, base);
  if (fresh) return fresh;

  return diagnoseUncertain(input, pool, settings, now, stats, base);
}

/** Infrastructure: an outbreak, or a category that blames the platform. */
function diagnoseInfrastructure(
  ctx: DiagnoseInput,
  category: Category,
  stats: DiagnosticStats,
  base: DiagnosticBase,
): Diagnostic | undefined {
  const outbreak = ctx.outbreak;
  const infraCategory = category === 'infrastructure' || category === 'dependency';
  if (!outbreak && !infraCategory) return undefined;

  const confidence = outbreak ? CONFIDENCE.infrastructureOutbreak : CONFIDENCE.infrastructureCategory;
  const repos = outbreak ? outbreak.repos : [];
  const facts: DiagnosticFact[] = [
    { label: 'Occurrences', value: String(stats.occurrences) },
    { label: 'Repositories hit', value: String(repos.length) },
  ];
  if (outbreak) {
    facts.push({ label: 'Repositories', value: repos.join(', ') });
    facts.push({ label: 'Outbreak started at', value: outbreak.startedAt });
  }
  facts.push({ label: 'Category', value: category });

  const summary = outbreak
    ? `Infrastructure failure: the same error was reported by ${repos.length} repositories ` +
        `(${repos.join(', ')}) since ${outbreak.startedAt}. Wait and retry.`
    : `Infrastructure failure (category: ${category}). This is not related to the pull request; ` +
        `wait and retry.`;

  return applyPrudence(
    {
      kind: 'infrastructure',
      confidence,
      title: truncate(
        'Infrastructure failure — ' + (outbreak ? `same error in ${repos.length} repositories` : category),
      ),
      summary,
      action: 'wait',
      facts,
      evidence: evidenceFor(ctx, stats),
      ...base,
    },
    ctx,
  );
}

/** Already fixed: a known resolution the current branch does not contain. */
function diagnoseAlreadyFixed(
  ctx: DiagnoseInput,
  stats: DiagnosticStats,
  base: DiagnosticBase,
): Diagnostic | undefined {
  const resolution = ctx.resolution;
  if (!resolution || ctx.branchContainsResolution !== false) return undefined;

  const confirmed = Boolean(resolution.confirmedBy);
  const confidence = confirmed ? CONFIDENCE.alreadyFixedConfirmed : CONFIDENCE.alreadyFixedCandidate;
  const commit = resolution.commit.slice(0, 7);
  const facts: DiagnosticFact[] = [
    { label: 'Fixed by', value: resolution.author },
    { label: 'Fix commit', value: commit },
    { label: 'Confidence', value: confirmed ? 'confirmed' : 'candidate' },
    { label: 'Occurrences', value: String(stats.occurrences) },
  ];
  if (resolution.note) facts.push({ label: 'Note', value: resolution.note });
  if (resolution.files.length > 0) facts.push({ label: 'Files touched', value: resolution.files.join(', ') });

  return {
    kind: 'already-fixed',
    confidence,
    title: truncate(`Already fixed by ${resolution.author} in ${commit} — rebase your branch`),
    summary:
      `This error was already seen and fixed by ${resolution.author} in ${commit}` +
      (resolution.note ? ` (${resolution.note})` : '') +
      `. Your branch does not contain that commit yet: rebase or cherry-pick the fix.`,
    action: 'rebase',
    facts,
    resolution: {
      commit: resolution.commit,
      author: resolution.author,
      note: resolution.note,
      files: resolution.files,
      confirmed,
    },
    evidence: evidenceFor(ctx, stats),
    ...base,
  };
}

/** Flaky: the signature is provably unstable. */
function diagnoseFlaky(
  ctx: DiagnoseInput,
  pool: Occurrence[],
  settings: Settings,
  now: Date,
  stats: DiagnosticStats,
  base: DiagnosticBase,
): Diagnostic | undefined {
  const verdict = assessFlakiness(pool, { settings, now });
  if (!verdict.flaky) return undefined;

  const strong = verdict.branches >= 3 && verdict.sameCommitPass;
  const confidence = strong ? CONFIDENCE.flakyStrong : CONFIDENCE.flakyThreshold;
  const facts: DiagnosticFact[] = [
    { label: 'Occurrences', value: `${verdict.occurrences} on ${verdict.branches} branches` },
    { label: 'Passed at the same commit', value: verdict.sameCommitPass ? 'yes' : 'no' },
    { label: 'Flaky index', value: String(verdict.flakyIndex) },
    { label: 'Window', value: `${settings.flakyWindowDays} days` },
  ];

  return applyPrudence(
    {
      kind: 'flaky',
      confidence,
      title: truncate(`Flaky test — ${verdict.occurrences} failures on ${verdict.branches} branches`),
      summary:
        `This failure was seen ${verdict.occurrences} times on ${verdict.branches} branches over the last ` +
        `${settings.flakyWindowDays} days, and the same commit passed after a failure. ` +
        `It is very likely unrelated to your pull request: retry the build.`,
      action: 'retry',
      facts,
      evidence: [...verdict.reasons, ...evidenceFor(ctx, stats)],
      ...base,
    },
    ctx,
  );
}

/** New: neither the signature nor the family was ever seen before. */
function diagnoseNew(
  ctx: DiagnoseInput,
  stats: DiagnosticStats,
  base: DiagnosticBase,
): Diagnostic | undefined {
  if (ctx.history.length > 0 || ctx.familyHistory.length > 0) return undefined;

  const frames = ctx.frames ?? ctx.signature?.frames ?? [];
  const suspects = computeSuspects(ctx.changedFiles ?? ctx.occurrence.changedFiles ?? [], frames);
  const confidence = frames.length > 0 ? CONFIDENCE.newWithStack : CONFIDENCE.newWithoutStack;
  const facts: DiagnosticFact[] = [
    { label: 'First seen at', value: stats.firstSeen },
    { label: 'Occurrences', value: String(stats.occurrences) },
    { label: 'Category', value: ctx.category ?? ctx.signature?.category ?? 'unknown' },
  ];
  if (suspects.length > 0) facts.push({ label: 'Suspect files', value: suspects.join(', ') });

  return {
    kind: 'new',
    confidence,
    title: truncate(
      suspects.length > 0
        ? `New failure — likely caused by ${suspects[0]}`
        : 'New failure — first time this error is seen',
    ),
    summary:
      `First appearance of this error` +
      (suspects.length > 0
        ? `, and your pull request touches ${suspects.join(', ')} which appears in the stack`
        : '') +
      `. The failing step is ${ctx.occurrence.stepName}. This looks related to your change: fix it.`,
    action: 'fix',
    facts,
    suspects: suspects.length > 0 ? suspects : undefined,
    evidence: evidenceFor(ctx, stats),
    ...base,
  };
}

/** Uncertain: not enough evidence, so we show the facts and stop. */
function diagnoseUncertain(
  ctx: DiagnoseInput,
  pool: Occurrence[],
  settings: Settings,
  now: Date,
  stats: DiagnosticStats,
  base: DiagnosticBase,
): Diagnostic {
  const facts: DiagnosticFact[] = [
    { label: 'Occurrences', value: String(stats.occurrences) },
    { label: 'Branches', value: String(stats.branches) },
    { label: 'Repositories', value: String(stats.repos) },
    { label: 'First seen at', value: stats.firstSeen },
    { label: 'Last seen at', value: stats.lastSeen },
  ];
  const verdict = assessFlakiness(pool, { settings, now });
  facts.push({ label: 'Same-commit success', value: verdict.sameCommitPass ? 'yes' : 'no' });

  return {
    kind: 'uncertain',
    confidence: CONFIDENCE.uncertain,
    title: truncate('Uncertain — not enough history to blame or excuse this failure'),
    summary:
      `This error was seen ${stats.occurrences} time(s) on ${stats.branches} branch(es) across ${stats.repos} repository(ies). ` +
      `There is not enough evidence yet to say whether it is related to your pull request.`,
    action: 'none',
    facts,
    evidence: [...verdict.reasons, ...evidenceFor(ctx, stats)],
    ...base,
  };
}

/**
 * Prudence (§ 18): below `minConfidenceNotYourFault`, a verdict that excuses
 * the pull request becomes `uncertain`. Facts and evidence are kept.
 */
function applyPrudence(diagnostic: Diagnostic, ctx: DiagnoseInput): Diagnostic {
  const settings = resolveSettings(ctx.settings);
  if (!EXCUSING_KINDS.has(diagnostic.kind)) return diagnostic;
  if (diagnostic.confidence >= settings.minConfidenceNotYourFault) return diagnostic;

  return {
    ...diagnostic,
    kind: 'uncertain',
    action: 'none',
    title: truncate('Uncertain — not enough evidence to rule this failure out'),
    summary:
      `Not enough evidence to say whether this failure is related to your pull request ` +
      `(confidence ${diagnostic.confidence} < ${settings.minConfidenceNotYourFault}). Facts below.`,
    evidence: diagnostic.evidence,
  };
}

/** The occurrence plus its known history: what the verdict is built on. */
function poolOccurrences(ctx: DiagnoseInput): Occurrence[] {
  const seen = new Set<string>();
  const pool: Occurrence[] = [];
  for (const occ of [...ctx.history, ctx.occurrence]) {
    if (seen.has(occ.id)) continue;
    seen.add(occ.id);
    pool.push(occ);
  }
  return pool;
}

/** Aggregate figures shown next to every verdict. */
function buildStats(pool: Occurrence[]): DiagnosticStats {
  const branches = new Set(pool.map((occ) => occ.branch));
  const repos = new Set(pool.map((occ) => occ.repo));
  const times = pool.map((occ) => Date.parse(occ.occurredAt)).filter((t) => Number.isFinite(t));
  const firstSeen = times.length > 0 ? new Date(Math.min(...times)).toISOString() : '';
  const lastSeen = times.length > 0 ? new Date(Math.max(...times)).toISOString() : '';
  return {
    occurrences: pool.length,
    branches: branches.size,
    repos: repos.size,
    firstSeen,
    lastSeen,
    sameCommitPass: pool.some((occ) => occ.passedOnRetry),
  };
}

/** Raw facts that justify the verdict (§ 18). */
function evidenceFor(ctx: DiagnoseInput, stats: DiagnosticStats): string[] {
  return [
    `occurrence ${ctx.occurrence.id} on ${ctx.occurrence.repo}/${ctx.occurrence.branch} at ${ctx.occurrence.occurredAt}`,
    `commit ${ctx.occurrence.commit}`,
    `${stats.occurrences} occurrence(s) on ${stats.branches} branch(es) in ${stats.repos} repository(ies)`,
  ];
}

/** Files changed by the pull request that appear in the stack. */
function computeSuspects(changedFiles: string[], frames: Frame[]): string[] {
  const stackFiles = frames.filter((frame) => frame.isProject).map((frame) => frame.file);
  const suspects: string[] = [];
  for (const changed of changedFiles) {
    const hit = stackFiles.some((stackFile) => samePath(stackFile, changed));
    if (hit && !suspects.includes(changed)) suspects.push(changed);
  }
  return suspects;
}

/** Loose path comparison: suffix match on path segments. */
function samePath(a: string, b: string): boolean {
  const clean = (value: string): string => value.replace(/^\.\//, '').replace(/^\/+/, '');
  const left = clean(a);
  const right = clean(b);
  return left === right || left.endsWith('/' + right) || right.endsWith('/' + left);
}

/** Guess the category from the raw error text when the caller does not know it. */
function guessCategory(ctx: DiagnoseInput): Category {
  const text = (ctx.errorText ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (/registry|npm err|unresolved dependency|could not resolve|failed to resolve dependency/.test(text)) {
    return 'dependency';
  }
  if (
    /etimedout|enotfound|econnrefused|connection refused|unreachable|out of memory|no space left|docker daemon/.test(
      text,
    )
  ) {
    return 'infrastructure';
  }
  return 'unknown';
}

/**
 * Short readable identifier (`S-204`).
 *
 * Derived from the tail of the signature hash, so the same signature always
 * shows the same short id.
 */
function shortSignatureId(signatureId: string): string {
  const hex = signatureId.replace(/[^0-9a-f]/gi, '');
  if (hex.length >= 4) {
    const tail = parseInt(hex.slice(-4), 16) % 1000;
    return 'S-' + String(tail).padStart(3, '0');
  }
  return 'S-000';
}

/** Keep the card title short enough for the pull request card. */
function truncate(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + '…';
}
