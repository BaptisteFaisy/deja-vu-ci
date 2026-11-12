/**
 * The "What the app did" tab of the project page.
 *
 * One line per action the app took: the instant, the action, the signature it
 * concerns, the ticket it touched and a short complement. The lines are read by
 * the `audit-log` resolver and shaped here — the journal itself is written where
 * the actions happen (`src/consumer.ts`, `src/scheduled.ts`, the curation and
 * quarantine resolvers).
 */

import React from 'react';
import { Inline, Stack, Tag, Text } from '@forge/react';
import type { AuditLine } from '../pure/auditLog';
import { formatDate } from './format';
import { t, type Lang } from './i18n';

/** One line of the journal. */
function AuditRow(props: {
  lang: Lang;
  entry: AuditLine;
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, entry, shortId } = props;
  return (
    <Inline space="space.200">
      <Text>{formatDate(entry.createdAt, lang)}</Text>
      <Tag color="grey" text={t(`audit.${entry.action}`, lang)} />
      <Text>{entry.signatureId ? shortId(entry.signatureId) : '-'}</Text>
      <Text>{entry.issueKey ?? '-'}</Text>
      <Text>{entry.detail ?? ''}</Text>
    </Inline>
  );
}

/** The journal, newest first, or its explicit empty state. */
export function AuditTab(props: {
  lang: Lang;
  entries: AuditLine[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, entries, shortId } = props;
  if (entries.length === 0) {
    return <Text>{t('audit.empty', lang)}</Text>;
  }
  return (
    <Stack space="space.100">
      {entries.map((entry) => (
        <AuditRow key={entry.id} lang={lang} entry={entry} shortId={shortId} />
      ))}
    </Stack>
  );
}
