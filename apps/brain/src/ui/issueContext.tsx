/**
 * Encart de ticket (§ 14, écran 4).
 *
 * Deux cas :
 *  - **ticket de développement** : le diagnostic du dernier build de sa branche ;
 *  - **ticket de problème** : le tableau des occurrences de la signature.
 *
 * Les données viennent du Cerveau par `invoke()` ; le diagnostic est rendu
 * tel que le moteur l'a produit (même source que la carte de PR).
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Heading,
  Inline,
  SectionMessage,
  Stack,
  Tag,
  Text,
} from '@forge/react';
import type { Diagnostic } from '@dejavu/core';
import { formatDate, shortCommit, toOccurrenceRows, type OccurrenceRow } from './format.js';
import { loadData } from './data.js';
import { t, type Lang } from './i18n.js';

/** Ce que rend le Cerveau pour l'encart de ticket. */
interface IssueContextPayload {
  /** Diagnostic du dernier build de la branche (ticket de développement). */
  diagnostic?: Diagnostic;
  /** Occurrences de la signature (ticket de problème). */
  occurrences?: Parameters<typeof toOccurrenceRows>[0];
  /** Vrai si le ticket est un ticket de problème. */
  problem?: boolean;
}

/** Libellé du diagnostic selon sa nature. */
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

/** Encart affiché sur un ticket Jira. */
export default function IssueContext(): React.JSX.Element {
  const [lang, setLang] = useState<Lang>('en');
  const [payload, setPayload] = useState<IssueContextPayload | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    loadData<IssueContextPayload>('issue-context')
      .then((value) => setPayload(value))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  if (error) {
    return <SectionMessage appearance="error">{error}</SectionMessage>;
  }

  const diagnostic = payload?.diagnostic;
  const rows: OccurrenceRow[] = payload?.occurrences
    ? toOccurrenceRows(payload.occurrences)
    : [];

  return (
    <Stack space="space.200">
      <Heading size="medium">{t('issue.diagnostic', lang)}</Heading>
      {diagnostic ? (
        <Box>
          <Inline alignInline="center" space="space.200">
            <Text>{diagnosisLabel(diagnostic, lang)}</Text>
            <Tag text={diagnostic.action} />
            <Text>
              {t('confidence', lang)}: {Math.round(diagnostic.confidence * 100)}%
            </Text>
            {diagnostic.issueKey && <Text>{diagnostic.issueKey}</Text>}
          </Inline>
          <Text>{diagnostic.summary}</Text>
          {diagnostic.resolution && (
            <Inline space="space.200">
              <Text>{t('issue.resolution', lang)}</Text>
              <Text>{shortCommit(diagnostic.resolution.commit)}</Text>
              <Text>{diagnostic.resolution.author}</Text>
              <Text>{diagnostic.resolution.note ?? ''}</Text>
            </Inline>
          )}
        </Box>
      ) : (
        <Text>{t('issue.noFailure', lang)}</Text>
      )}

      {payload?.problem && (
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
      )}

      <Button appearance="subtle" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}>
        {lang === 'en' ? 'Français' : 'English'}
      </Button>
    </Stack>
  );
}
