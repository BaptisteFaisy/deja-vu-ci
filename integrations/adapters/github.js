// GitHub Actions log adapter.
//
// `input` is the wire-format of one failed workflow step: the raw step log
// plus the repository context (as resolved from GITHUB_* environment
// variables). The adapter extracts the step name, the exit code, the duration
// and any failed test cases the log carries, into one normalised report.

import { extractTestCases, parseDurationS, parseExitCode, tailBytes } from './lib.js';

function extractStep(log) {
  const match = log.match(/^##\[group\](?:Run\s+)?(.*)$/m);
  return match ? match[1].trim() || undefined : undefined;
}

export function fromGitHub(input) {
  const log = tailBytes(input.log ?? '', 51200);
  return {
    format: 'github-actions',
    repository: input.repository ?? 'unknown-repo',
    branch: input.branch ?? 'unknown-branch',
    commit: input.commit ?? '',
    author: input.actor ?? input.author ?? 'unknown',
    step: input.step ?? extractStep(log) ?? input.job ?? 'build',
    log,
    failedAt: input.failedAt,
    durationS: parseDurationS(log),
    exitCode: parseExitCode(log),
    testCases: extractTestCases(log),
  };
}