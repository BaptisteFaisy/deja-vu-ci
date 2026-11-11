/**
 * Page projet « Mémoire de CI » (§ 14, écran 3).
 *
 * L'écran montre les signatures connues (statut, catégorie, occurrences,
 * dernière vue, ticket), avec filtres et recherche par texte, puis quatre
 * onglets : **Signatures**, **Tests instables**, **Résolutions à confirmer** et
 * **Coût**. En dessous, deux panneaux ajoutés par ce lot : **Curation**
 * (fusionner / scinder des signatures, CI-17) et **Quarantaine** (proposer la
 * mise en quarantaine d'un test instable, CI-19) — tous deux en aperçu avant
 * confirmation, sans écriture en mémoire.
 *
 * En tête, le bouton « Rejouer le jeu d'exemple » (§ 22, CI-11) remplit une
 * mémoire neuve : sans lui, un juge qui installe l'app voit des écrans vides.
 * Après une injection la page se relit, donc les signatures apparaissent tout
 * de suite (`sampleReplay.tsx`).
 *
 * Les données viennent du Cerveau par `invoke()` (module `action`) ; la mise en
 * forme (statut → libellé et couleur, tri, filtres) vit dans `format.ts` et les
 * libellés dans `i18n.ts`. Ce composant reste mince : il place des valeurs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
} from './format';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import { MemoryTabs, PageHeader, Toolbar } from './projectPageParts';
import { SampleReplay } from './sampleReplay';
import { Curation } from './curation';
import { QuarantinePanel } from './quarantine';

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

  /**
   * (Re)lit la mémoire : au montage de l'écran, puis après un rejeu du jeu
   * d'exemple — le bouton vide une page neuve, il faut donc relire.
   */
  const reload = useCallback(() => {
    setError(undefined);
    loadData<MemoryPayload>('memory-page')
      .then((payload) => setData(payload))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
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

      <Toolbar
        lang={lang}
        filter={filter}
        sort={sort}
        onFilter={setFilter}
        onSort={setSort}
        onLang={setLang}
      />

      <MemoryTabs lang={lang} rows={visible} pending={data?.pending ?? []} costRows={costRows} />

      <Curation lang={lang} signatures={data?.signatures ?? []} shortId={shortId} />

      <QuarantinePanel lang={lang} signatures={data?.signatures ?? []} shortId={shortId} />
    </Stack>
  );
}
