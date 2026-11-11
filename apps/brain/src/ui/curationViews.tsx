/**
 * Presentational views of the curation previews (CI-17).
 *
 * No `invoke()` here: the panel (`curation.tsx`) loads the data and hands it
 * over. The decision logic lives in `src/pure/curation.ts` (tested); these
 * components only place values, exactly like the rest of `src/ui/`.
 */

import React from 'react';
import { Code, Inline, Stack, Tag, Text } from '@forge/react';
import type { Signature } from '@dejavu/core';
import { statusBadge } from './format';
import { t, type Lang } from './i18n';
import type { MergePreviewData, SplitPreviewAnswer } from '../pure/curation';

/** One "label → value" line. */
function Field({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <Inline space="space.100">
      <Text>{label}</Text>
      <Text>{value}</Text>
    </Inline>
  );
}

/** The signature kept after a merge, with what the merge preserved. */
function MergedSignature(props: {
  lang: Lang;
  merged: Signature;
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, merged, shortId } = props;
  const badge = statusBadge(merged.status, lang);
  return (
    <Stack space="space.050">
      <Inline space="space.100">
        <Text>{shortId(merged.id)}</Text>
        <Tag color={badge.tone} text={badge.label} />
      </Inline>
      <Field label={t('column.firstSeen', lang)} value={merged.firstSeen} />
      <Field label={t('column.lastSeen', lang)} value={merged.lastSeen} />
      <Field label={t('column.occurrences', lang)} value={String(merged.occurrences)} />
      <Field label={t('column.issue', lang)} value={merged.issueKey ?? '-'} />
    </Stack>
  );
}

/** The suggested normalization rule: token, pattern, and whether it is covered. */
function RuleView({ lang, data }: { lang: Lang; data: MergePreviewData }): React.JSX.Element | null {
  const rule = data.rule;
  if (!rule) return null;
  return (
    <Stack space="space.050">
      <Text>{t('curate.rule', lang)}</Text>
      <Field label={t('curate.token', lang)} value={<Code>{rule.token}</Code>} />
      <Field label={t('curate.pattern', lang)} value={<Code>{rule.pattern}</Code>} />
      <Field label={t('curate.replacement', lang)} value={<Code>{rule.replacement}</Code>} />
      <Text>
        {rule.alreadyCovered
          ? t('curate.rule.covered', lang)
          : t('curate.rule.uncovered', lang)}
      </Text>
    </Stack>
  );
}

/** The merge preview: kept signature, retired one, moved occurrences, rule. */
export function MergePreviewView(props: {
  lang: Lang;
  data: MergePreviewData;
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, data, shortId } = props;
  return (
    <Stack space="space.100">
      <Text>{t('curate.merged', lang)}</Text>
      <MergedSignature lang={lang} merged={data.merged} shortId={shortId} />
      <Field label={t('curate.retired', lang)} value={shortId(data.retired.id)} />
      <Field label={t('curate.moved', lang)} value={String(data.movedOccurrences)} />
      <RuleView lang={lang} data={data} />
    </Stack>
  );
}

/** The split preview: one line per group, biggest first. */
export function SplitPreviewView(props: {
  lang: Lang;
  answer: SplitPreviewAnswer;
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, answer, shortId } = props;
  if (!answer.ok) return <Text>{answer.error}</Text>;
  return (
    <Stack space="space.100">
      <Text>{t('curate.groups', lang)}</Text>
      {answer.data.groups.map((group, index) => (
        <Inline key={group.signature.id} space="space.100">
          <Text>{index === 0 ? '•' : '–'}</Text>
          <Text>{shortId(group.signature.id)}</Text>
          <Text>{String(group.occurrences.length)}</Text>
          <Text>{group.signature.template.slice(0, 60)}</Text>
        </Inline>
      ))}
    </Stack>
  );
}
