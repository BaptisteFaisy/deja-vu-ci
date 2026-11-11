// Jenkins log adapter.
//
// `input` carries the raw build log plus the Jenkins context (JOB_NAME,
// STAGE_NAME, GIT_BRANCH, GIT_COMMIT, BUILD_TAG). The adapter normalises it
// into the shared report: step, exit code, duration, test cases.

import { extractTestCases, parseDurationS, parseExitCode, tailBytes } from './lib.js';

function extractStep(log) {
  // "[Pipeline] { (Build)" — the stage name in braces, same line only.
  const brace = log.match(/\[Pipeline\]\s*\{\s*\((.+?)\)/);
  if (brace) return brace[1].trim() || undefined;
  // "Stage: Build" / "STEP: Build" on its own line.
  const echo = log.match(/^(?:Stage|STEP)\s*:\s*(.+)$/m);
  if (echo) return echo[1].trim() || undefined;
  return undefined;
}

export function fromJenkins(input) {
  const log = tailBytes(input.log ?? '', 51200);
  return {
    format: 'jenkins',
    repository: input.repository ?? input.jobName ?? 'unknown-repo',
    branch: input.branch ?? input.gitBranch ?? 'unknown-branch',
    commit: input.commit ?? input.gitCommit ?? '',
    author: input.author ?? 'unknown',
    step: input.step ?? input.stageName ?? extractStep(log) ?? 'build',
    log,
    failedAt: input.failedAt,
    durationS: parseDurationS(log),
    exitCode: parseExitCode(log),
    testCases: extractTestCases(log),
  };
}