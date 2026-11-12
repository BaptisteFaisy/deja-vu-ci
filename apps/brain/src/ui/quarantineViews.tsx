/**
 * Presentational views of the quarantine proposal (CI-19, § 25).
 *
 * The panel (`quarantine.tsx`) calls the `quarantine-proposal` resolver and
 * hands the answer over. When `assessFlakiness` did not call the test unstable,
 * the screen shows the reasons and proposes nothing — `proposeQuarantine`
 * stays the single authority. These components only place values.
 */

import React from 'react';
import { CodeBlock, Inline, Stack, Tag, Text } from '@forge/react';
import type { QuarantineProposal } from '@dejavu/core';
import { t, type Lang } from './i18n';
import type { ProposeQuarantineData, WorthItThresholds } from '../actions/propose-quarantine';

/** One "label → value" line. */
function Field({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <Inline space="space.100">
      <Text>{label}</Text>
      <Text>{value}</Text>
    </Inline>
  );
}

/** The cost of the flaky test, with the three thresholds behind `worthIt`. */
function CostView(props: {
  lang: Lang;
  proposal: QuarantineProposal;
  thresholds: WorthItThresholds;
}): React.JSX.Element {
  const { lang, proposal, thresholds } = props;
  const cost = proposal.cost;
  return (
    <Stack space="space.050">
      <Field label={t('column.occurrences', lang)} value={String(cost.occurrences)} />
      <Field label={t('quarantine.branches', lang)} value={String(cost.branches)} />
      <Field label={t('column.minutes', lang)} value={String(cost.ciMinutesLost)} />
      <Field label={t('quarantine.flakyIndex', lang)} value={cost.flakyIndex.toFixed(2)} />
      <Text>{t('quarantine.thresholds', lang)}</Text>
      <Field label={t('column.minutes', lang)} value={`≥ ${thresholds.ciMinutesLost}`} />
      <Field label={t('quarantine.flakyIndex', lang)} value={`≥ ${thresholds.flakyIndex}`} />
      <Field label={t('column.occurrences', lang)} value={`≥ ${thresholds.occurrences}`} />
    </Stack>
  );
}

/** The repair ticket: summary, owner, deadline, labels. */
function TicketView({ lang, proposal }: { lang: Lang; proposal: QuarantineProposal }): React.JSX.Element {
  const ticket = proposal.ticket;
  return (
    <Stack space="space.050">
      <Text>{t('quarantine.ticket', lang)}</Text>
      <Text>{ticket.summary}</Text>
      <Field label={t('quarantine.due', lang)} value={String(ticket.dueInDays)} />
      {ticket.assignee ? (
        <Field label={t('quarantine.assignee', lang)} value={ticket.assignee} />
      ) : null}
      <Inline space="space.100">
        {ticket.labels.map((label) => (
          <Tag key={label} color="yellow" text={label} />
        ))}
      </Inline>
    </Stack>
  );
}

/** The idiomatic skip snippet of the ecosystem, and where to put it. */
function PatchView({ lang, proposal }: { lang: Lang; proposal: QuarantineProposal }): React.JSX.Element {
  const patch = proposal.patch;
  return (
    <Stack space="space.050">
      <Field label={t('quarantine.ecosystem', lang)} value={patch.ecosystem} />
      <Field label={t('quarantine.file', lang)} value={patch.file} />
      <Text>{patch.instruction}</Text>
      <Text>{t('quarantine.snippet', lang)}</Text>
      <CodeBlock text={patch.snippet} />
    </Stack>
  );
}

/** The whole proposal: verdict, snippet, ticket, cost. */
export function ProposalView(props: {
  lang: Lang;
  proposal: QuarantineProposal;
  thresholds: WorthItThresholds;
}): React.JSX.Element {
  const { lang, proposal, thresholds } = props;
  return (
    <Stack space="space.100">
      <Inline space="space.100">
        <Text>{proposal.testName}</Text>
        <Tag
          color={proposal.worthIt ? 'green' : 'grey'}
          text={proposal.worthIt ? t('quarantine.worthIt', lang) : t('quarantine.notWorthIt', lang)}
        />
      </Inline>
      <PatchView lang={lang} proposal={proposal} />
      <TicketView lang={lang} proposal={proposal} />
      <CostView lang={lang} proposal={proposal} thresholds={thresholds} />
    </Stack>
  );
}

/** Renders the answer of the `quarantine-proposal` resolver. */
export function QuarantineAnswerView(props: {
  lang: Lang;
  answer: { ok: true; data: ProposeQuarantineData } | { ok: false; error: string };
}): React.JSX.Element {
  const { lang, answer } = props;
  if (!answer.ok) return <Text>{answer.error}</Text>;
  const data = answer.data;
  if (!data.flaky || !data.proposal) {
    return (
      <Stack space="space.050">
        <Text>{t('quarantine.notFlaky', lang)}</Text>
        <Text>{t('quarantine.reasons', lang)}</Text>
        {data.reasons.map((reason) => (
          <Text key={reason}>{`• ${reason}`}</Text>
        ))}
      </Stack>
    );
  }
  return <ProposalView lang={lang} proposal={data.proposal} thresholds={data.thresholds} />;
}
