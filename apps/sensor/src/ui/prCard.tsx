/**
 * The pull-request card (§ 14, screen 1).
 *
 * The card asks the Sensor's resolver `getPrCard`, which asks the Brain for
 * the diagnostic of the branch and returns its `QueryResponse` unchanged. The
 * card only places the values of the view model built in
 * `src/pure/prCardView.ts`: nature of the failure, confidence, title,
 * summary, facts, suggested action and the ticket of the problem.
 *
 * Three states besides the diagnostic are rendered on purpose — loading,
 * "no known failure", and the reason why the Brain could not answer (an
 * unpaired workspace says so): a card that shows nothing teaches nothing.
 */

import React, { useEffect, useState } from 'react';
import { Box, Inline, SectionMessage, Spinner, Stack, Tag, Text } from '@forge/react';
import type { QueryResponse } from '@dejavu/core';
import { t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { prCardView, type PrCardView } from '../pure/prCardView.js';
import { loadData } from './data.js';
import { LanguageButton, type ScreenProps } from './parts.js';

/** The diagnostic itself: what the developer reads first. */
function Diagnostic({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element {
  return (
    <Stack space="space.100">
      <Inline alignInline="center" space="space.200">
        {view.headline && view.tone ? <Tag color={view.tone} text={view.headline} /> : null}
        {view.confidence ? (
          <Text>
            {t('diagnostic.confidence', lang)}: {view.confidence}
          </Text>
        ) : null}
        {view.issueKey ? <Text>{view.issueKey}</Text> : null}
      </Inline>
      {view.title ? <Text>{view.title}</Text> : null}
      {view.summary ? <Text>{view.summary}</Text> : null}
      {view.action ? (
        <Text>
          {t('diagnostic.action', lang)}: {view.action}
        </Text>
      ) : null}
      <Facts view={view} lang={lang} />
    </Stack>
  );
}

/** The facts and the raw excerpts the diagnosis rests on (§ 18). */
function Facts({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element | null {
  if (view.facts.length === 0 && view.evidence.length === 0 && view.suspects.length === 0) {
    return null;
  }
  return (
    <Stack space="space.050">
      {view.facts.length > 0 ? <Text>{t('diagnostic.facts', lang)}</Text> : null}
      {view.facts.map((fact) => (
        <Text key={fact}>{fact}</Text>
      ))}
      {view.resolution ? (
        <Text>
          {t('diagnostic.resolution', lang)}: {view.resolution}
        </Text>
      ) : null}
      {view.lastFailure ? (
        <Text>
          {t('diagnostic.lastFailure', lang)}: {view.lastFailure}
        </Text>
      ) : null}
      {view.suspects.length > 0 ? <Text>{t('diagnostic.suspects', lang)}</Text> : null}
      {view.suspects.map((suspect) => (
        <Text key={suspect}>{suspect}</Text>
      ))}
      {view.evidence.length > 0 ? <Text>{t('diagnostic.evidence', lang)}</Text> : null}
      {view.evidence.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
    </Stack>
  );
}

/** Renders one state of the card. */
function CardBody({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element {
  if (view.state === 'loading') {
    return (
      <Inline space="space.100">
        <Spinner size="small" />
        <Text>{t('common.loading', lang)}</Text>
      </Inline>
    );
  }
  if (view.state === 'error') {
    return <SectionMessage appearance="warning">{view.error ?? t('error.title', lang)}</SectionMessage>;
  }
  if (view.state === 'empty') {
    return <Text>{t('diagnostic.noMatch', lang)}</Text>;
  }
  return <Diagnostic view={view} lang={lang} />;
}

/** The card of a pull request. */
export default function PrCard({ lang, onLang }: ScreenProps): React.JSX.Element {
  const [response, setResponse] = useState<QueryResponse | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  useEffect(() => {
    loadData<QueryResponse>('getPrCard')
      .then((value) => setResponse(value))
      .catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const view = prCardView(failure ? { ok: false, error: failure } : response, lang);

  return (
    <Box>
      <Stack space="space.200">
        <CardBody view={view} lang={lang} />
        <LanguageButton lang={lang} onLang={onLang} />
      </Stack>
    </Box>
  );
}
