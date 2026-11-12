import React from 'react';
import {
  Box,
  Button,
  Heading,
  Inline,
  Label,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
  Textfield,
} from '@forge/react';
import { formatDate, type CostRow, type SignatureFilter, type SignatureRow, type SignatureSortKey } from './format';
import { t, type Lang } from './i18n';
import type { AuditLine } from '../pure/auditLog';
import type { CostTrend } from '../pure/costTrend';
import { AuditTab } from './auditTab';
import { CostTrendView } from './costTrendView';

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

/** Barre d'outils : recherche, tri et langue. */
export function Toolbar(props: {
  lang: Lang;
  filter: SignatureFilter;
  sort: SignatureSortKey;
  onFilter: (filter: SignatureFilter) => void;
  onSort: (sort: SignatureSortKey) => void;
  onLang: (lang: Lang) => void;
}): React.JSX.Element {
  const { lang, filter, sort, onFilter, onSort, onLang } = props;
  return (
    <Inline space="space.200">
        <Box>
          <Label labelFor="ci-memory-search">{t('filter.search', lang)}</Label>
          <Textfield
            id="ci-memory-search"
            value={filter.text ?? ''}
            onChange={(event) => onFilter({ ...filter, text: event.target.value })}
          />
        </Box>
        <Button
          appearance="subtle"
          onClick={() => onSort(sort === 'lastSeen' ? 'occurrences' : 'lastSeen')}
        >
          {t('column.lastSeen', lang)} / {t('column.occurrences', lang)}
        </Button>
        <Button appearance="subtle" onClick={() => onLang(lang === 'en' ? 'fr' : 'en')}>
          {lang === 'en' ? 'Français' : 'English'}
        </Button>
      </Inline>
  );
}

/** Résolutions à confirmer (§ 8.3). */
export function PendingTab({
  lang,
  pending,
}: {
  lang: Lang;
  pending: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
}): React.JSX.Element {
  return (
    <Stack space="space.100">
      {pending.map((row) => (
        <Inline key={row.signatureId} space="space.200">
          <Text>{row.signatureId}</Text>
          <Text>{row.commit}</Text>
          <Text>{row.author}</Text>
          <Text>{row.note ?? ''}</Text>
        </Inline>
      ))}
      {pending.length === 0 && <Text>{t('empty.pending', lang)}</Text>}
    </Stack>
  );
}

/** Onglet Coût (§ 14, CI-14). */
export function CostTab({ lang, rows }: { lang: Lang; rows: CostRow[] }): React.JSX.Element {
  return (
    <Stack space="space.100">
      {rows.map((row) => (
        <Inline key={row.signatureId} space="space.200">
          <Text>{row.shortId}</Text>
          <Text>{row.ciMinutesLost}</Text>
          <Text>{row.peopleAffected}</Text>
          <Text>{row.retries}</Text>
        </Inline>
      ))}
      {rows.length === 0 && <Text>{t('empty.cost', lang)}</Text>}
    </Stack>
  );
}

/** The five tabs of the "CI Memory" page. */
export function MemoryTabs(props: {
  lang: Lang;
  rows: SignatureRow[];
  pending: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
  costRows: CostRow[];
  trend?: CostTrend;
  audit: AuditLine[];
  shortId: (id: string) => string;
}): React.JSX.Element {
  const { lang, rows, pending, costRows, trend, audit, shortId } = props;
  return (
    <Tabs id="ci-memory-tabs">
      <TabList>
        <Tab>{t('tab.signatures', lang)}</Tab>
        <Tab>{t('tab.flaky', lang)}</Tab>
        <Tab>{t('tab.pending', lang)}</Tab>
        <Tab>{t('tab.cost', lang)}</Tab>
        <Tab>{t('tab.audit', lang)}</Tab>
      </TabList>

      <TabPanel>
        {rows.length === 0 ? (
          <Text>{t('empty.signatures', lang)}</Text>
        ) : (
          <Stack space="space.100">
            {rows.map((row) => (
              <SignatureLine key={row.id} row={row} lang={lang} />
            ))}
          </Stack>
        )}
      </TabPanel>

      <TabPanel>
        <Text>{t('empty.flaky', lang)}</Text>
      </TabPanel>

      <TabPanel>
        <PendingTab lang={lang} pending={pending} />
      </TabPanel>

      <TabPanel>
        <Stack space="space.300">
          <CostTab lang={lang} rows={costRows} />
          <CostTrendView lang={lang} trend={trend} />
        </Stack>
      </TabPanel>

      <TabPanel>
        <AuditTab lang={lang} entries={audit} shortId={shortId} />
      </TabPanel>
    </Tabs>
  );
}

/** Titre et sous-titre de la page « Mémoire de CI ». */
export function PageHeader({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <Box>
      <Heading size="large">{t('page.title', lang)}</Heading>
      <Text>{t('page.subtitle', lang)}</Text>
    </Box>
  );
}
