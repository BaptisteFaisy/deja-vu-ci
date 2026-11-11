// CI log adapters — public surface and the universal-payload projection.
//
// Each adapter turns the raw log + repo context of one CI into a normalised
// report. `toUniversalPayload` then projects that report onto the exact
// `UniversalPayload` shape the Brain expects (`packages/core/src/universal.ts`).
// Duration and exit code have no home in that shape today, so they stay as
// report metadata (available to callers, dropped from the payload) — a known
// gap signalled upstream.

export * from './lib.js';
export { fromGitHub } from './github.js';
export { fromGitLab } from './gitlab.js';
export { fromJenkins } from './jenkins.js';

/**
 * Project a normalised report onto the universal payload.
 *
 * `projectKey` is mandatory (it authenticates the call). The journal is
 * already bounded by the adapters; the rerouted `testCases` keep only the
 * fields the Brain accepts (name, message, stack).
 */
export function toUniversalPayload(report, projectKey) {
  const payload = {
    projectKey,
    repository: report.repository,
    branch: report.branch,
    log: report.log,
  };
  if (report.commit) payload.commit = report.commit;
  if (report.author) payload.author = report.author;
  if (report.step) payload.step = report.step;
  if (report.failedAt) payload.failedAt = report.failedAt;
  const cases = (report.testCases ?? []).map((item) => ({
    name: item.name,
    message: item.message,
    ...(item.stack ? { stack: item.stack } : {}),
  }));
  if (cases.length > 0) payload.testCases = cases;
  return payload;
}