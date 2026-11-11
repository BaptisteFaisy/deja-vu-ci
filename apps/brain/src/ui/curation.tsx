/**
 * Curation panel of the CI Memory page (CI-17, § 19).
 *
 * Two gestures, both previewed **before** anything is written:
 *   - merge two signatures: the screen shows what is kept (strongest status,
 *     single ticket, oldest `firstSeen`) and the normalization rule that would
 *     have kept them together;
 *   - split one signature by a criterion (test name, branch, repository, step)
 *     and show the groups produced.
 *
 * The panel is thin: it holds the selection, calls the `curate-merge` /
 * `curate-split` resolvers and hands the answer to `curationViews.tsx`. All the
 * decision logic is in `src/pure/curation.ts` (tested without React).
 */

import React, { useState } from 'react';
import { Button, Heading, SectionMessage, Stack, Text } from '@forge/react';
import type { Signature } from '@dejavu/core';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import {
  SPLIT_CRITERION_KEYS,
  type MergePreviewAnswer,
  type SplitCriterionKey,
  type SplitPreviewAnswer,
} from '../pure/curation';
import { MergePreviewView, SplitPreviewView } from './curationViews';
import { errorMessage, signatureOptions, type Option } from './controls';
import { LabeledRadio } from './pickers';

/** The criterion options, in the order `SPLIT_CRITERION_KEYS`. */
function criterionOptions(lang: Lang): Option[] {
  return SPLIT_CRITERION_KEYS.map((key) => ({
    label: t(`criterion.${key}`, lang),
    value: key,
  }));
}

/** Renders the answer of a merge preview: error, kept signature, or nothing. */
function MergeAnswer(props: {
  lang: Lang;
  answer: MergePreviewAnswer | undefined;
  shortId: (id: string) => string;
}): React.JSX.Element | null {
  const { lang, answer, shortId } = props;
  if (!answer) return null;
  if (!answer.ok) return <SectionMessage appearance="error">{answer.error}</SectionMessage>;
  return <MergePreviewView lang={lang} data={answer.data} shortId={shortId} />;
}

/** Renders the answer of a split preview: error, groups, or nothing. */
function SplitAnswer(props: {
  lang: Lang;
  answer: SplitPreviewAnswer | undefined;
  shortId: (id: string) => string;
}): React.JSX.Element | null {
  const { lang, answer, shortId } = props;
  if (!answer) return null;
  if (!answer.ok) return <SectionMessage appearance="error">{answer.error}</SectionMessage>;
  return <SplitPreviewView lang={lang} answer={answer} shortId={shortId} />;
}

/** The merge gesture: two signatures, a preview, nothing written. */
function MergePanel(props: {
  lang: Lang;
  options: Option[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, options, shortId } = props;
  const [keepId, setKeepId] = useState('');
  const [dropId, setDropId] = useState('');
  const [answer, setAnswer] = useState<MergePreviewAnswer | undefined>();
  const [busy, setBusy] = useState(false);

  const merge = (): void => {
    setBusy(true);
    loadData<MergePreviewAnswer>('curate-merge', { keepId, dropId })
      .then(setAnswer)
      .catch((cause: unknown) => setAnswer({ ok: false, error: errorMessage(cause) }))
      .finally(() => setBusy(false));
  };

  return (
    <Stack space="space.100">
      <LabeledRadio
        label={t('curate.keep', lang)}
        name="curate-keep"
        options={options}
        value={keepId}
        onChange={setKeepId}
      />
      <LabeledRadio
        label={t('curate.drop', lang)}
        name="curate-drop"
        options={options}
        value={dropId}
        onChange={setDropId}
      />
      <Button
        appearance="primary"
        onClick={merge}
        isDisabled={busy || keepId.length === 0 || dropId.length === 0}
      >
        {t('curate.merge', lang)}
      </Button>
      <MergeAnswer lang={lang} answer={answer} shortId={shortId} />
    </Stack>
  );
}

/** The split gesture: one signature, one criterion, a preview of the groups. */
function SplitPanel(props: {
  lang: Lang;
  options: Option[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, options, shortId } = props;
  const [signatureId, setSignatureId] = useState('');
  const [criterion, setCriterion] = useState<SplitCriterionKey>('test-name');
  const [answer, setAnswer] = useState<SplitPreviewAnswer | undefined>();
  const [busy, setBusy] = useState(false);

  const split = (): void => {
    setBusy(true);
    loadData<SplitPreviewAnswer>('curate-split', { signatureId, criterion })
      .then(setAnswer)
      .catch((cause: unknown) => setAnswer({ ok: false, error: errorMessage(cause) }))
      .finally(() => setBusy(false));
  };

  return (
    <Stack space="space.100">
      <LabeledRadio
        label={t('column.signature', lang)}
        name="curate-split-sig"
        options={options}
        value={signatureId}
        onChange={setSignatureId}
      />
      <LabeledRadio
        label={t('curate.criterion', lang)}
        name="curate-criterion"
        options={criterionOptions(lang)}
        value={criterion}
        onChange={(value) => setCriterion(value as SplitCriterionKey)}
      />
      <Button appearance="primary" onClick={split} isDisabled={busy || signatureId.length === 0}>
        {t('curate.split', lang)}
      </Button>
      <SplitAnswer lang={lang} answer={answer} shortId={shortId} />
    </Stack>
  );
}

/** The whole curation panel, added below the CI Memory tabs. */
export function Curation(props: {
  lang: Lang;
  signatures: Signature[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, signatures, shortId } = props;
  if (signatures.length === 0) {
    return (
      <Stack space="space.100">
        <Heading size="medium">{t('curate.title', lang)}</Heading>
        <Text>{t('empty.signatures', lang)}</Text>
      </Stack>
    );
  }
  const options = signatureOptions(signatures, shortId);
  return (
    <Stack space="space.200">
      <Heading size="medium">{t('curate.title', lang)}</Heading>
      <MergePanel lang={lang} options={options} shortId={shortId} />
      <SplitPanel lang={lang} options={options} shortId={shortId} />
    </Stack>
  );
}
