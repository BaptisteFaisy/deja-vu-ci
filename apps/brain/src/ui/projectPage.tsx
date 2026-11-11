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
import {
  Box,
  Button,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
  Textfield,
} from '@forge/react';
import type { CostReport, Signature } from '@dejavu/core';
import {
  filterSignatureRows,
  formatDate,
  sortSignatureRows,
  toCostRows,
  toSignatureRows,
  type CostRow,
  type SignatureFilter,
  type SignatureRow,
  type SignatureSortKey,
} from './format.js';
import { loadData } from './data.js';
import { t, type Lang } from './i18n.js';

/** Ce que rend le Cerveau pour la page projet. */
interface MemoryPayload {
  signatures: Signature[];
  cost?: CostReport;
  pending?: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
  shortIds?: Record<string, string>;
}

/** Onglets de la page. */
const TABS = ['signatures', 'flaky', 'pending', 'cost'] as const;

type TabKey = (typeof TABS)[number];

/** Ligne du tableau des signatures. */
function SignatureLine({ row, lang }: { row: SignatureRow; lang: Lang }): React.JSX.Element {
  return (
    <Box>
      <Inline alignInline="center" space="space.200">
        <Text>{row.shortId}</Text>
        <Tag color={row.badge.tone} text={row.badge.label} />
        <Text>{row.categoryLabel}</Text>
        <Text>{row.occurrences}</Text>
        <Text>{formatDate(row.lastSeen, lang)}</Text>
        <Text>{row.issueKey ?? '-'}</Text>
      </Inline>
    </Box>
  );
}

/** Page projet « Mémoire de CI ». */
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
      <Box>
        <Heading size="large">{t('page.title', lang)}</Heading>
        <Text>{t('page.subtitle', lang)}</Text>
      </Box>

      <Inline space="space.200">
        <Box>
          <Label labelFor="ci-memory-search">{t('filter.search', lang)}</Label>
          <Textfield
            id="ci-memory-search"
            value={filter.text ?? ''}
            onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          />
        </Box>
        <Button
          appearance="subtle"
          onClick={() => setSort(sort === 'lastSeen' ? 'occurrences' : 'lastSeen')}
        >
          {t('column.lastSeen', lang)} / {t('column.occurrences', lang)}
        </Button>
        <Button appearance="subtle" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}>
          {lang === 'en' ? 'Français' : 'English'}
        </Button>
      </Inline>

      <Tabs id="ci-memory-tabs">
        <TabList>
          <Tab>{t('tab.signatures', lang)}</Tab>
          <Tab>{t('tab.flaky', lang)}</Tab>
          <Tab>{t('tab.pending', lang)}</Tab>
          <Tab>{t('tab.cost', lang)}</Tab>
        </TabList>

        <TabPanel>
          {visible.length === 0 ? (
            <Text>{t('empty.signatures', lang)}</Text>
          ) : (
            <Stack space="space.100">
              {visible.map((row) => (
                <SignatureLine key={row.id} row={row} lang={lang} />
              ))}
            </Stack>
          )}
        </TabPanel>

        <TabPanel>
          <Text>{t('empty.flaky', lang)}</Text>
        </TabPanel>

        <TabPanel>
          <Stack space="space.100">
            {(data?.pending ?? []).map((pending) => (
              <Inline key={pending.signatureId} space="space.200">
                <Text>{pending.signatureId}</Text>
                <Text>{pending.commit}</Text>
                <Text>{pending.author}</Text>
                <Text>{pending.note ?? ''}</Text>
              </Inline>
            ))}
            {(data?.pending ?? []).length === 0 && <Text>{t('empty.pending', lang)}</Text>}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.100">
            {costRows.map((row) => (
              <Inline key={row.signatureId} space="space.200">
                <Text>{row.shortId}</Text>
                <Text>{row.ciMinutesLost}</Text>
                <Text>{row.peopleAffected}</Text>
                <Text>{row.retries}</Text>
              </Inline>
            ))}
            {costRows.length === 0 && <Text>{t('empty.cost', lang)}</Text>}
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}
