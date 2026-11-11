/**
 * The pull-request card, Custom UI flavour (§ 14, screen 1).
 *
 * The card asks the Sensor's resolver `getPrCard`, which asks the Brain for
 * the diagnostic of the branch and returns its `QueryResponse` unchanged. The
 * card only places the values of the view model built in
 * `src/pure/prCardView.ts`: nature of the failure, confidence, title,
 * summary, facts, suggested action and the ticket of the problem — the same
 * model the UI Kit screen placed, so both languages and every label come
 * from `@dejavu/present`.
 *
 * Three states besides the diagnostic are rendered on purpose — loading,
 * "no known failure", and the reason why the Brain could not answer (an
 * unpaired workspace says so): a card that shows nothing teaches nothing.
 */

import React, { useEffect, useState } from 'react';
import type { QueryResponse } from '@dejavu/core';
import { t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { prCardView, type PrCardView } from '../pure/prCardView';
import { loadData } from './data';
import { LanguageButton, type ScreenProps } from './parts';

/** One titled list of lines (facts, suspects, evidence). */
function Lines(props: {
  titleKey?: string;
  lines: string[];
  lang: Lang;
  code?: boolean;
}): React.JSX.Element | null {
  const { titleKey, lines, lang, code } = props;
  if (lines.length === 0) return null;
  return (
    <div className="dv-stack">
      {titleKey ? <span className="dv-label">{t(titleKey, lang)}</span> : null}
      {lines.map((line) =>
        code ? (
          <code key={line} className="dv-evidence">
            {line}
          </code>
        ) : (
          <span key={line}>{line}</span>
        ),
      )}
    </div>
  );
}

/** The facts and the raw excerpts the diagnosis rests on (§ 18). */
function Facts({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element | null {
  if (view.facts.length === 0 && view.evidence.length === 0 && view.suspects.length === 0) {
    return null;
  }
  return (
    <div className="dv-stack dv-facts">
      <Lines titleKey="diagnostic.facts" lines={view.facts} lang={lang} />
      {view.resolution ? (
        <span>
          {t('diagnostic.resolution', lang)}: {view.resolution}
        </span>
      ) : null}
      {view.lastFailure ? (
        <span>
          {t('diagnostic.lastFailure', lang)}: {view.lastFailure}
        </span>
      ) : null}
      <Lines titleKey="diagnostic.suspects" lines={view.suspects} lang={lang} />
      <Lines titleKey="diagnostic.evidence" lines={view.evidence} lang={lang} code />
    </div>
  );
}

/** The diagnostic itself: what the developer reads first. */
function Diagnostic({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element {
  return (
    <div className="dv-stack">
      <div className="dv-row">
        {view.headline && view.tone ? (
          <span className={`dv-tag dv-tag--${view.tone}`}>{view.headline}</span>
        ) : null}
        {view.confidence ? (
          <span>
            {t('diagnostic.confidence', lang)}: {view.confidence}
          </span>
        ) : null}
        {view.issueKey ? <span className="dv-issue">{view.issueKey}</span> : null}
      </div>
      {view.title ? <span className="dv-title">{view.title}</span> : null}
      {view.summary ? <span className="dv-muted">{view.summary}</span> : null}
      {view.action ? (
        <span>
          {t('diagnostic.action', lang)}: <strong>{view.action}</strong>
        </span>
      ) : null}
      <Facts view={view} lang={lang} />
    </div>
  );
}

/** Renders one state of the card. */
function CardBody({ view, lang }: { view: PrCardView; lang: Lang }): React.JSX.Element {
  if (view.state === 'loading') {
    return (
      <div className="dv-row">
        <span className="dv-spinner" role="status" aria-label={t('common.loading', lang)} />
        <span className="dv-muted">{t('common.loading', lang)}</span>
      </div>
    );
  }
  if (view.state === 'error') {
    return <p className="dv-message dv-message--warning">{view.error ?? t('error.title', lang)}</p>;
  }
  if (view.state === 'empty') {
    return <p className="dv-muted">{t('diagnostic.noMatch', lang)}</p>;
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
    <div className="dv-card">
      <CardBody view={view} lang={lang} />
      <div className="dv-row dv-footer">
        <LanguageButton lang={lang} onLang={onLang} />
      </div>
    </div>
  );
}
