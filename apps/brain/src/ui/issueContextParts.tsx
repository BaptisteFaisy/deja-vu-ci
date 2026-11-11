/**
 * Pieces of the issue panel (§ 14, screen 4).
 *
 * Two distinct displays: a development ticket shows the diagnostic of the
 * latest build of its branch, a problem ticket shows the occurrence table of
 * its signature. Keeping them apart avoids one component with two jobs.
 *
 * The words come from `@dejavu/present`: the Bitbucket PR card says exactly
 * the same thing about the same diagnostic.
 */

import React from 'react';
import { Box, Heading, Inline, Stack, Tag, Text } from '@forge/react';
import type { Diagnostic } from '@dejavu/core';
import { actionLabel, diagnosticLabel, formatConfidence } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { formatDate, shortCommit, toOccurrenceRows, type OccurrenceRow } from './format.js';
import { t } from './i18n.js';

/** The diagnostic of the latest red build, with its fix when there is one. */
export function DiagnosticPanel(props: {
  lang: Lang;
  diagnostic: Diagnostic | undefined;
}): React.JSX.Element {
  const { lang, diagnostic } = props;
  if (!diagnostic) return <Text>{t('diagnostic.none', lang)}</Text>;
  return (
    <Box>
      <Inline alignInline="center" space="space.200">
        <Text>{diagnosticLabel(diagnostic.kind, lang)}</Text>
        <Tag text={actionLabel(diagnostic.action, lang)} />
        <Text>
          {t('diagnostic.confidence', lang)}: {formatConfidence(diagnostic.confidence)}
        </Text>
        {diagnostic.issueKey ? <Text>{diagnostic.issueKey}</Text> : null}
      </Inline>
      <Text>{diagnostic.summary}</Text>
      {diagnostic.resolution ? <ResolutionLine lang={lang} diagnostic={diagnostic} /> : null}
    </Box>
  );
}

/** The fix cited by an "already seen, already fixed" diagnostic. */
function ResolutionLine({ lang, diagnostic }: { lang: Lang; diagnostic: Diagnostic }): React.JSX.Element {
  const resolution = diagnostic.resolution;
  // UI Kit 12: `Text` requires children — the defensive empty line renders
  // an empty text node instead of a childless element.
  if (!resolution) return <Text>{''}</Text>;
  return (
    <Inline space="space.200">
      <Text>{t('diagnostic.resolution', lang)}</Text>
      <Text>{shortCommit(resolution.commit)}</Text>
      <Text>{resolution.author}</Text>
      <Text>{resolution.note ?? ''}</Text>
    </Inline>
  );
}

/** The occurrence table of a problem ticket. */
export function OccurrenceTable(props: { lang: Lang; rows: OccurrenceRow[] }): React.JSX.Element {
  const { lang, rows } = props;
  return (
    <>
      <Heading size="medium">{t('issue.occurrences', lang)}</Heading>
      <Stack space="space.100">
        {rows.map((row) => (
          <Inline key={`${row.occurredAt}-${row.commit}`} space="space.200">
            <Text>{formatDate(row.occurredAt, lang)}</Text>
            <Text>{row.repo}</Text>
            <Text>{row.branch}</Text>
            <Text>{shortCommit(row.commit)}</Text>
            <Text>{row.author}</Text>
          </Inline>
        ))}
      </Stack>
    </>
  );
}

/** Converts the occurrences served by the Brain into displayable rows. */
export { toOccurrenceRows };
