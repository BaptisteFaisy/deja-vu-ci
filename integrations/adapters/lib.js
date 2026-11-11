// Shared normalisation helpers for the CI log adapters.
//
// Each helper turns a piece of a raw CI log (GitHub Actions, GitLab CI or
// Jenkins) into the normalised field the universal entry needs: step, duration
// in seconds, exit code, and failed test cases when the log carries a test
// report. Zero dependencies — regexes over text.

/** Bound a log to a maximum number of bytes (keep the tail). */
export function tailBytes(text, maxBytes) {
  if (!text) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return buffer.subarray(buffer.length - maxBytes).toString('utf8').replace(/^\uFFFD+/, '');
}

/** Exit code from a recognised CI line, or undefined. */
export function parseExitCode(text) {
  const match = text.match(/exit\s*(?:code|status)\s*[:=]?\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

const UNIT_SECONDS = {
  ms: 0.001,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
};

/** Duration in seconds from a recognised CI line, or undefined. */
export function parseDurationS(text) {
  // Jenkins-style compound duration: "Total duration: 3 min 5 sec".
  const compound = text.match(/(\d+(?:\.\d+)?)\s*min\w*\s*(\d+(?:\.\d+)?)\s*sec\w*/i);
  if (compound) return Number(compound[1]) * 60 + Number(compound[2]);
  // Generic: "Duration: 12.34 seconds", "duration=500ms".
  const single = text.match(/duration[=:]?\s*(\d+(?:\.\d+)?)\s*(ms|sec\w*|min\w*)/i);
  if (single) return Number(single[1]) * (UNIT_SECONDS[single[2].toLowerCase()] ?? 1);
  return undefined;
}

/** Failed test cases from pytest / Jest / Go lines in the log. */
export function extractTestCases(text) {
  const cases = [];
  // pytest: "FAILED path/to/test.py::TestClass::test_a - assert 1 == 2"
  for (const match of text.matchAll(/FAILED\s+(\S+)\s*-\s*(.*)$/gm)) {
    cases.push({ name: match[1], message: match[2].trim() });
  }
  // Jest: "✕ should render" (and "● block › test" summary lines).
  for (const match of text.matchAll(/[✕×]\s+(.+)$/gm)) {
    cases.push({ name: match[1].trim(), message: 'test failed' });
  }
  // Go: "--- FAIL: TestName"
  for (const match of text.matchAll(/--- FAIL:\s*(\S+)/g)) {
    cases.push({ name: match[1], message: 'test failed' });
  }
  return dedupeCases(cases).slice(0, 50);
}

function dedupeCases(cases) {
  const seen = new Set();
  const out = [];
  for (const item of cases) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}