/**
 * The browser side of the export panel.
 *
 * The document itself is produced by the resolver (`src/pure/exportMemory.ts`)
 * — the browser never builds the CSV or the JSON of the memory. This module
 * only hands the ready document to the browser as a file, which is the one job
 * a resolver cannot do. It is the only place of the app touching `document`,
 * and it stays out of the tested modules.
 */

/** Offers `content` to the browser as a downloadable file. */
export function downloadFile(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
