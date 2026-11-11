/**
 * Morceaux de l'encart ticket (§ 14, écran 4).
 *
 * Deux affichages distincts : pour un ticket de développement, le diagnostic du
 * dernier build de sa branche ; pour un ticket de problème, le tableau des
 * occurrences. Les garder séparés évite un composant à deux responsabilités.
 */

import React from 'react';
import { Box, Heading, Inline, Stack, Tag, Text } from '@forge/react';
import type { Diagnostic } from '@dejavu/core';
import { formatDate, shortCommit, toOccurrenceRows, type OccurrenceRow } from './format.js';
import { t, type Lang } from './i18n.js';

/** Libellé traduit du diagnostic. */
function diagnosisLabel(diagnostic: Diagnostic, lang: Lang): string {
  const keys: Record<Diagnostic['kind'], string> = {
    flaky: 'diagnosis.flaky',
    'already-fixed': 'diagnosis.alreadyFixed',
    new: 'diagnosis.new',
    infrastructure: 'diagnosis.infrastructure',
    uncertain: 'diagnosis.uncertain',
  };
  return t(keys[diagnostic.kind], lang);
}

/** Le diagnostic du dernier build rouge, avec sa résolution le cas échéant. */
export function DiagnosticPanel(props: {
  lang: Lang;
  diagnostic: Diagnostic | undefined;
}): React.JSX.Element {
  const { lang, diagnostic } = props;
  if (!diagnostic) return <Text>{t('issue.noFailure', lang)}</Text>;
  return (
    <Box>
      <Inline alignInline="center" space="space.200">
        <Text>{diagnosisLabel(diagnostic, lang)}</Text>
        <Tag text={diagnostic.action} />
        <Text>
          {t('confidence', lang)}: {Math.round(diagnostic.confidence * 100)}%
        </Text>
        {diagnostic.issueKey ? <Text>{diagnostic.issueKey}</Text> : null}
      </Inline>
      <Text>{diagnostic.summary}</Text>
      {diagnostic.resolution ? <ResolutionLine lang={lang} diagnostic={diagnostic} /> : null}
    </Box>
  );
}

/** Le correctif cité par un diagnostic « déjà vu, déjà corrigé ». */
function ResolutionLine({ lang, diagnostic }: { lang: Lang; diagnostic: Diagnostic }): React.JSX.Element {
  const resolution = diagnostic.resolution;
  // UI Kit 12: `Text` requires children — the defensive empty line renders
  // an empty text node instead of a childless element.
  if (!resolution) return <Text>{''}</Text>;
  return (
    <Inline space="space.200">
      <Text>{t('issue.resolution', lang)}</Text>
      <Text>{shortCommit(resolution.commit)}</Text>
      <Text>{resolution.author}</Text>
      <Text>{resolution.note ?? ''}</Text>
    </Inline>
  );
}

/** Le tableau des occurrences d'un ticket de problème. */
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

/** Convertit les occurrences du serveur en lignes affichables. */
export { toOccurrenceRows };
