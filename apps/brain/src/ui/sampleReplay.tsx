/**
 * Le bouton « Rejouer le jeu d'exemple » de la page projet (§ 22, CI-11).
 *
 * Un juge installe le Cerveau, clique ici, et la mémoire se remplit : 40 échecs
 * sur 14 jours deviennent signatures, diagnostics et tickets. Sans ce bouton les
 * écrans installés restent vides.
 *
 * Le composant est mince : il appelle `replay-sample` (le résolveur UI de
 * `src/resolvers.ts`, qui délègue à `src/seed.ts`), affiche un état « en cours »,
 * puis le résumé. Toute la mise en forme des textes vit dans `sampleSummary.ts`
 * (module pur, testé) et les libellés dans `i18n.ts` — rien n'est dupliqué.
 */

import React, { useState } from 'react';
import { Button, Inline, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import {
  statusText,
  summaryLine,
  type ReplayState,
  type ReplaySummaryView,
} from './sampleSummary';

export function SampleReplay(props: {
  lang: Lang;
  /** Appelé après une injection réussie : la page relit la mémoire. */
  onSeeded?: () => void;
}): React.JSX.Element {
  const { lang, onSeeded } = props;
  const [state, setState] = useState<ReplayState>('idle');
  const [summary, setSummary] = useState<ReplaySummaryView | undefined>();
  const [error, setError] = useState<string | undefined>();

  const replay = (): void => {
    setState('running');
    setError(undefined);
    loadData<ReplaySummaryView>('replay-sample')
      .then((payload) => {
        setSummary(payload);
        if (!payload || payload.ok === false) {
          setState('failed');
          setError(payload?.error);
          return;
        }
        setState('done');
        if (payload.seeded && onSeeded) onSeeded();
      })
      .catch((cause: unknown) => {
        setState('failed');
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  const message = statusText(state, summary, error, lang);

  return (
    <Stack space="space.100">
      <Inline space="space.200">
        <Button appearance="primary" onClick={replay} isDisabled={state === 'running'}>
          {t('sample.button', lang)}
        </Button>
        {state === 'running' ? <Spinner size="small" /> : null}
      </Inline>
      {state === 'failed' ? <SectionMessage appearance="error">{message}</SectionMessage> : null}
      {state === 'done' && summary ? (
        <SectionMessage appearance={summary.seeded ? 'success' : 'information'}>
          <Stack space="space.050">
            <Text>{message}</Text>
            <Text>{summaryLine(summary, lang)}</Text>
          </Stack>
        </SectionMessage>
      ) : null}
    </Stack>
  );
}
