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
import { Button, Heading, SectionMessage, Stack } from '@forge/react';
import type { Diagnostic } from '@dejavu/core';
import { toOccurrenceRows, type OccurrenceRow } from './format';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import { DiagnosticPanel, OccurrenceTable } from './issueContextParts';

/** Ce que rend le Cerveau pour l'encart de ticket. */
interface IssueContextPayload {
  /** Diagnostic du dernier build de la branche (ticket de développement). */
  diagnostic?: Diagnostic;
  /** Occurrences de la signature (ticket de problème). */
  occurrences?: Parameters<typeof toOccurrenceRows>[0];
  /** Vrai si le ticket est un ticket de problème. */
  problem?: boolean;
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
      <DiagnosticPanel lang={lang} diagnostic={diagnostic} />

      {payload?.problem ? <OccurrenceTable lang={lang} rows={rows} /> : null}

      <Button appearance="subtle" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}>
        {lang === 'en' ? 'Français' : 'English'}
      </Button>
    </Stack>
  );
}
