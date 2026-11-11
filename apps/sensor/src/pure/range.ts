/**
 * Byte-range helpers for partial reads — pure, no Forge import.
 *
 * Bitbucket Pipelines step logs can weigh tens of megabytes (§ 19). The
 * Sensor therefore asks for the tail of the log with a partial request
 * (`Range` header) instead of downloading the whole file.
 *
 * The exact range syntax accepted by the Pipelines log endpoint is one of
 * the points to confirm with a prototype (§ 17 of the specification);
 * the helpers below follow the HTTP byte-range conventions and are the
 * single place to adjust if the endpoint differs.
 */

/** Default size of the log tail read by the Sensor: 64 KiB. */
export const DEFAULT_TAIL_BYTES = 64 * 1024;

/**
 * `Range` header asking for the last `tailBytes` bytes of a resource.
 *
 * `bytes=-65536` is the suffix range: "the last 64 KiB".
 */
export function tailRangeHeader(tailBytes: number = DEFAULT_TAIL_BYTES): string {
  const size = Math.max(1, Math.floor(tailBytes));
  return `bytes=-${size}`;
}

/**
 * `Range` header asking for an explicit inclusive window.
 */
export function byteRangeHeader(start: number, end: number): string {
  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from, Math.floor(end));
  return `bytes=${from}-${to}`;
}

/**
 * Reads the total size advertised by a `Content-Range` response header
 * (`bytes 0-1023/20480`). Returns `undefined` when the header is absent or
 * the size is unknown (`*`).
 */
export function parseContentRangeTotal(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const match = /\/(\d+)\s*$/.exec(header.trim());
  if (!match) return undefined;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : undefined;
}

/**
 * Keeps the last `maxBytes` bytes of a body that was read in full
 * (fallback when the endpoint ignores the `Range` header).
 */
export function keepTail(text: string, maxBytes: number = DEFAULT_TAIL_BYTES): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;
  let start = buffer.byteLength - maxBytes;
  while (start < buffer.byteLength && (buffer[start] & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString('utf8');
}
