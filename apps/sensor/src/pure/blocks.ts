/**
 * Error-block selection and truncation — pure, no Forge import.
 *
 * The Sensor must never send more than 50 KiB of raw error material to the
 * Brain (§ 8.1 step 3 and § 19: "only the tail of a huge log is read").
 * Blocks are kept in the order they were found; the first ones win.
 */

/** Total budget for the raw error blocks of one occurrence: 50 KiB. */
export const MAX_TOTAL_BLOCK_BYTES = 50 * 1024;

/** Maximum number of distinct blocks kept for one step (§ 19). */
export const MAX_BLOCKS = 3;

/** Outcome of the selection: kept blocks, dropped ones, truncation flag. */
export interface BlockSelection {
  /** Blocks kept, in order, already truncated to the budget. */
  blocks: string[];
  /** Number of blocks discarded because the budget was exhausted. */
  dropped: number;
  /** True when at least one block had to be cut in the middle. */
  truncated: boolean;
}

/**
 * Cuts a string to at most `maxBytes` bytes without breaking a UTF-8
 * sequence: the cut happens on the last complete character boundary.
 */
export function truncateText(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}

/** Byte length of a string, as the Forge payload limit counts it. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Keeps the most relevant blocks within the byte budget.
 *
 * Blocks longer than the whole budget are cut, not dropped: a truncated
 * block still carries the beginning of the failure, which is what the
 * extraction step needs.
 */
export function selectBlocks(
  candidates: readonly string[],
  maxBytes: number = MAX_TOTAL_BLOCK_BYTES,
  maxBlocks: number = MAX_BLOCKS,
): BlockSelection {
  const blocks: string[] = [];
  let used = 0;
  let dropped = 0;
  let truncated = false;
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text) continue;
    if (blocks.length >= maxBlocks) {
      dropped += 1;
      continue;
    }
    const remaining = maxBytes - used;
    if (remaining <= 0) {
      dropped += 1;
      continue;
    }
    const size = byteLength(text);
    if (size > remaining) {
      blocks.push(truncateText(text, remaining));
      truncated = true;
      used = maxBytes;
      continue;
    }
    blocks.push(text);
    used += size;
  }
  return { blocks, dropped, truncated };
}
