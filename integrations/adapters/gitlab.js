// GitLab CI log adapter.
//
// `input` carries the raw job log plus the GitLab context (CI_PROJECT_PATH,
// CI_COMMIT_REF_NAME, CI_COMMIT_SHA, CI_JOB_NAME, CI_JOB_ID). The adapter
// normalises it into the shared report: step, exit code, duration, test cases.

import { extractTestCases, parseDurationS, parseExitCode, tailBytes } from './lib.js';

function extractStep(log) {
  const match = log.match(/section_start:\s*\d+:([^\r\n:]+)/);
  return match ? match[1].trim() || undefined : undefined;
}

export function fromGitLab(input) {
  const log = tailBytes(input.log ?? '', 51200);
  return {
    format: 'gitlab-ci',
    repository: input.repository ?? input.projectPath ?? 'unknown-repo',
    branch: input.branch ?? input.refName ?? 'unknown-branch',
    commit: input.commit ?? '',
    author: input.author ?? 'unknown',
    step: input.step ?? input.jobName ?? extractStep(log) ?? 'build',
    log,
    failedAt: input.failedAt,
    durationS: parseDurationS(log),
    exitCode: parseExitCode(log),
    testCases: extractTestCases(log),
  };
}