/**
 * Page projet « Mémoire de CI » (§ 14, écran 3).
 *
 * L'écran montre les signatures connues (statut, catégorie, occurrences,
 * dernière vue, ticket), avec filtres et recherche par texte, puis trois
 * onglets : **Tests instables**, **Résolutions à confirmer** et **Coût**.
 *
 * Les données viennent du Cerveau par `invoke()` (module `action`) ; la mise en
 * forme (statut → libellé et couleur, tri, filtres) vit dans `format.ts` et les
 * libellés dans `i18n.ts`. Ce composant reste mince : il place des valeurs.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Heading, SectionMessage, Stack, Text } from '@forge/react';
import type { CostReport, Signature } from '@dejavu/core';
import {
  filterSignatureRows,
  sortSignatureRows,
  toCostRows,
  toSignatureRows,
  type CostRow,
  type SignatureFilter,
  type SignatureSortKey,
} from './format.js';
import { loadData } from './data.js';
import { t, type Lang } from './i18n.js';
import { MemoryTabs, PageHeader, Toolbar } from './projectPageParts.js';

/** Ce que rend le Cerveau pour la page projet. */
interface MemoryPayload {
  signatures: Signature[];
  cost?: CostReport;
  pending?: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
  shortIds?: Record<string, string>;
}

export default function ProjectPage(): React.JSX.Element {
  const [lang, setLang] = useState<Lang>('en');
  const [filter, setFilter] = useState<SignatureFilter>({});
  const [sort, setSort] = useState<SignatureSortKey>('lastSeen');
  const [data, setData] = useState<MemoryPayload | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    loadData<MemoryPayload>('memory-page')
      .then((payload) => setData(payload))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

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

      <Toolbar
        lang={lang}
        filter={filter}
        sort={sort}
        onFilter={setFilter}
        onSort={setSort}
        onLang={setLang}
      />

      <MemoryTabs lang={lang} rows={visible} pending={data?.pending ?? []} costRows={costRows} />
    </Stack>
  );
}
