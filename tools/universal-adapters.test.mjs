// Tests of the CI log adapters (integrations/adapters). Pure functions over
// text — no network, no disk.

import { describe, expect, it } from 'vitest';
import {
  extractTestCases,
  fromGitHub,
  fromGitLab,
  fromJenkins,
  parseDurationS,
  parseExitCode,
  tailBytes,
  toUniversalPayload,
} from '../integrations/adapters/index.js';

describe('parseExitCode', () => {
  it('reads GitHub, GitLab and Jenkins exit-code lines', () => {
    expect(parseExitCode('Error: Process completed with exit code 1.')).toBe(1);
    expect(parseExitCode('ERROR: Job failed: exit code 2')).toBe(2);
    expect(parseExitCode('ERROR: script returned exit code 3')).toBe(3);
    expect(parseExitCode('exit status 4')).toBe(4);
  });

  it('returns undefined when there is no exit code', () => {
    expect(parseExitCode('all green')).toBeUndefined();
  });
});

describe('parseDurationS', () => {
  it('reads single-unit durations in ms, seconds and minutes', () => {
    expect(parseDurationS('Duration: 500ms')).toBeCloseTo(0.5);
    expect(parseDurationS('Duration: 4.20 seconds')).toBeCloseTo(4.2);
    expect(parseDurationS('duration=2 min')).toBeCloseTo(120);
  });

  it('reads a compound Jenkins duration', () => {
    expect(parseDurationS('Total duration: 3 min 5 sec')).toBeCloseTo(185);
  });
});

describe('extractTestCases', () => {
  it('parses pytest, Jest and Go failures', () => {
    const log = [
      'FAILED tests/test_x.py::TestX::test_a - assert 1 == 2',
      '✕ should render the header',
      '--- FAIL: TestThing',
    ].join('\n');
    const cases = extractTestCases(log);
    expect(cases.map((c) => c.name)).toEqual([
      'tests/test_x.py::TestX::test_a',
      'should render the header',
      'TestThing',
    ]);
  });
});

describe('tailBytes', () => {
  it('keeps the tail when the log exceeds the cap', () => {
    const long = 'a'.repeat(60000);
    expect(tailBytes(long, 51200).length).toBe(51200);
    expect(tailBytes('short', 51200)).toBe('short');
  });
});

const GITHUB_LOG = [
  '##[group]Run make test',
  'FAILED tests/test_x.py::TestX::test_a - assert 1 == 2',
  'Error: Process completed with exit code 1.',
  'Duration: 4.20 seconds',
  '##[endgroup]',
].join('\n');

const GITLAB_LOG = [
  'section_start:1710000000:test',
  '$ make test',
  'ERROR: Job failed: exit code 1',
  'Duration: 12.34 seconds',
].join('\n');

const JENKINS_LOG = [
  '[Pipeline] stage',
  'ERROR: script returned exit code 1',
  'Total duration: 3 min 5 sec',
].join('\n');

describe('fromGitHub', () => {
  it('normalises step, exit code, duration and test cases', () => {
    const report = fromGitHub({ log: GITHUB_LOG, repository: 'o/r', branch: 'main', commit: 'abc' });
    expect(report.format).toBe('github-actions');
    expect(report.step).toBe('make test');
    expect(report.exitCode).toBe(1);
    expect(report.durationS).toBeCloseTo(4.2);
    expect(report.testCases).toHaveLength(1);
    expect(report.testCases[0].name).toBe('tests/test_x.py::TestX::test_a');
  });
});

describe('fromGitLab', () => {
  it('normalises step, exit code and duration', () => {
    const report = fromGitLab({ log: GITLAB_LOG, projectPath: 'o/r', refName: 'main', commit: 'abc' });
    expect(report.format).toBe('gitlab-ci');
    expect(report.step).toBe('test');
    expect(report.exitCode).toBe(1);
    expect(report.durationS).toBeCloseTo(12.34);
  });
});

describe('fromJenkins', () => {
  it('normalises step, exit code and compound duration', () => {
    const report = fromJenkins({ log: JENKINS_LOG, jobName: 'o/r', gitBranch: 'main', gitCommit: 'abc' });
    expect(report.format).toBe('jenkins');
    expect(report.exitCode).toBe(1);
    expect(report.durationS).toBeCloseTo(185);
    expect(report.step).toBe('build');
  });
});

describe('toUniversalPayload', () => {
  it('projects the report onto the exact UniversalPayload shape', () => {
    const report = fromGitHub({ log: GITHUB_LOG, repository: 'o/r', branch: 'main', commit: 'abc' });
    const payload = toUniversalPayload(report, '<proj>');
    expect(payload.projectKey).toBe('<proj>');
    expect(payload.repository).toBe('o/r');
    expect(payload.branch).toBe('main');
    expect(payload.commit).toBe('abc');
    expect(payload.step).toBe('make test');
    expect(payload.log).toContain('exit code 1');
    expect(payload.testCases).toHaveLength(1);
    // duration and exit code stay out of the payload (no home in the contract).
    expect(payload.durationS).toBeUndefined();
    expect(payload.exitCode).toBeUndefined();
  });
});