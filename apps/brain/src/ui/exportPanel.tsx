/**
 * The "Export the memory" panel of the project page.
 *
 * Two buttons, one per format. The document is built by the resolver
 * (`memory-export`) — the signatures, their occurrences and their resolutions,
 * as CSV or as JSON — so the browser only receives a ready file with a
 * timestamped name (`src/ui/download.ts`). A large memory is exported by the
 * app, never assembled in the screen.
 */

import React, { useState } from 'react';
import { Button, Heading, Inline, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { EXPORT_FORMATS, type ExportFormat, type MemoryExport } from '../pure/exportMemory';
import { loadData } from './data';
import { downloadFile } from './download';
import { t, type Lang } from './i18n';
import { errorMessage } from './controls';

/** What the `memory-export` resolver answers. */
type ExportAnswer = ({ ok: true } & MemoryExport) | { ok: false; error: string };

/** The label of one format's button. */
function buttonLabel(format: ExportFormat, lang: Lang): string {
  return format === 'csv' ? t('export.csv', lang) : t('export.json', lang);
}

/** The export panel: one button per format, and the outcome of the last one. */
export function ExportPanel({ lang }: { lang: Lang }): React.JSX.Element {
  const [busy, setBusy] = useState<ExportFormat | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const download = (format: ExportFormat): void => {
    setBusy(format);
    setError(undefined);
    setMessage(undefined);
    loadData<ExportAnswer>('memory-export', { format })
      .then((answer) => {
        if (!answer || answer.ok === false) {
          setError(answer?.error ?? t('export.failed', lang));
          return;
        }
        downloadFile(answer.filename, answer.content, answer.contentType);
        setMessage(`${t('export.done', lang)} — ${answer.filename}`);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(undefined));
  };

  return (
    <Stack space="space.100">
      <Heading size="medium">{t('export.title', lang)}</Heading>
      <Text>{t('export.hint', lang)}</Text>
      <Inline space="space.200">
        {EXPORT_FORMATS.map((format) => (
          <Button
            key={format}
            appearance="primary"
            onClick={() => download(format)}
            isDisabled={busy !== undefined}
          >
            {buttonLabel(format, lang)}
          </Button>
        ))}
        {busy ? <Spinner size="small" /> : null}
      </Inline>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {message ? <SectionMessage appearance="success">{message}</SectionMessage> : null}
    </Stack>
  );
}
