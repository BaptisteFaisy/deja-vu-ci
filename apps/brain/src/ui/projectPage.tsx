/**
 * Project page "CI Memory" (§ 14, screen 3).
 *
 * The screen shows the known signatures (status, category, occurrences, last
 * seen, ticket) with text filters and sorting, then five tabs: **Signatures**,
 * **Flaky tests**, **Resolutions to confirm**, **Cost** (with the daily trend of
 * the window) and **What the app did** (the journal of the actions the app took).
 *
 * Around the tabs, the panels this lot adds:
 *  - **Incident in progress** (CI-15): the infrastructure outbreak the engine
 *    detected, or one explicit empty line — never a ghost block;
 *  - **Curation** (CI-17) and **Quarantine** (CI-19), both previewed before any
 *    confirmation, already shipped and untouched here;
 *  - **Export the memory**: the signatures, occurrences and resolutions as CSV
 *    or JSON, built by the resolver;
 *  - **Memory health**: occupancy against the platform's 1 GiB, the oldest
 *    failure, the last purge.
 *
 * The header's "Replay the sample set" button (§ 22, CI-11) fills a fresh
 * memory; after an injection the page re-reads itself, so the signatures appear
 * at once (`sampleReplay.tsx`).
 *
 * The data comes from the Brain through `invoke()`; the shaping (status → label
 * and colour, sorting, filters) lives in `format.ts` and the labels in
 * `i18n.ts`. This component stays thin: it places values.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionMessage, Stack } from '@forge/react';
import type { CostReport, Signature } from '@dejavu/core';
import {
  filterSignatureRows,
  sortSignatureRows,
  toCostRows,
  toSignatureRows,
  type CostRow,
  type SignatureFilter,
  type SignatureSortKey,
} from './format';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import { MemoryTabs, PageHeader, Toolbar } from './projectPageParts';
import { SampleReplay } from './sampleReplay';
import { Curation } from './curation';
import { QuarantinePanel } from './quarantine';
import { IncidentPanelView } from './incidentPanel';
import { ExportPanel } from './exportPanel';
import { HealthPanel } from './healthPanel';
import { errorMessage } from './controls';
import type { CostTrend } from '../pure/costTrend';
import type { IncidentPanel } from '../pure/incident';
import type { AuditLine } from '../pure/auditLog';
import type { MemoryHealth } from '../pure/memoryHealth';

/** What the Brain answers for the project page. */
interface MemoryPayload {
  signatures: Signature[];
  cost?: CostReport;
  costTrend?: CostTrend;
  incident?: IncidentPanel;
  pending?: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
  shortIds?: Record<string, string>;
}

/** What the `audit-log` resolver answers. */
type AuditAnswer = { ok: true; entries: AuditLine[] } | { ok: false; error: string };

/** What the `memory-health` resolver answers. */
type HealthAnswer = { ok: true; health: MemoryHealth } | { ok: false; error: string };

export default function ProjectPage(): React.JSX.Element {
  const [lang, setLang] = useState<Lang>('en');
  const [filter, setFilter] = useState<SignatureFilter>({});
  const [sort, setSort] = useState<SignatureSortKey>('lastSeen');
  const [data, setData] = useState<MemoryPayload | undefined>();
  const [audit, setAudit] = useState<AuditLine[]>([]);
  const [health, setHealth] = useState<MemoryHealth | undefined>();
  const [error, setError] = useState<string | undefined>();

  /**
   * (Re)reads the memory: on mount, then after a replay of the sample set — the
   * button fills an empty page, so the three panels must be read again. A
   * failure of the journal or of the health degrades to their empty state: only
   * the memory itself is worth an error banner.
   */
  const reload = useCallback(() => {
    setError(undefined);
    loadData<MemoryPayload>('memory-page')
      .then((payload) => setData(payload))
      .catch((cause: unknown) => setError(errorMessage(cause)));
    loadData<AuditAnswer>('audit-log')
      .then((answer) => setAudit(answer?.ok ? answer.entries : []))
      .catch(() => setAudit([]));
    loadData<HealthAnswer>('memory-health')
      .then((answer) => setHealth(answer?.ok ? answer.health : undefined))
      .catch(() => setHealth(undefined));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const shortId = (id: string): string => data?.shortIds?.[id] ?? `S-${id.slice(-3)}`;
  const rows = useMemo(
    () => toSignatureRows(data?.signatures ?? [], shortId, lang),
    [data, lang],
  );
  const visible = useMemo(
    () => sortSignatureRows(filterSignatureRows(rows, filter), sort),
    [rows, filter, sort],
  );
  const costRows: CostRow[] = useMemo(
    () => (data?.cost ? toCostRows(data.cost, shortId) : []),
    [data],
  );

  if (error) {
    return <SectionMessage appearance="error">{error}</SectionMessage>;
  }

  return (
    <Stack space="space.300">
      <PageHeader lang={lang} />

      <SampleReplay lang={lang} onSeeded={reload} />

      <IncidentPanelView lang={lang} incident={data?.incident} />

      <Toolbar
        lang={lang}
        filter={filter}
        sort={sort}
        onFilter={setFilter}
        onSort={setSort}
        onLang={setLang}
      />

      <MemoryTabs
        lang={lang}
        rows={visible}
        pending={data?.pending ?? []}
        costRows={costRows}
        trend={data?.costTrend}
        audit={audit}
        shortId={shortId}
      />

      <Curation lang={lang} signatures={data?.signatures ?? []} shortId={shortId} />

      <QuarantinePanel lang={lang} signatures={data?.signatures ?? []} shortId={shortId} />

      <ExportPanel lang={lang} />

      {health ? <HealthPanel lang={lang} health={health} /> : null}
    </Stack>
  );
}
