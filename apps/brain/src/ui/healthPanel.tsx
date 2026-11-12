/**
 * The small memory-health panel of the project page.
 *
 * How full the memory is against the platform's 1 GiB, how many rows each table
 * holds, how old the oldest failure is, and when the app last purged the raw
 * excerpts it no longer needed. The occupancy is an **estimate**
 * (`src/pure/memoryHealth.ts`): the platform exposes no byte accounting, so the
 * panel is a warning light, not an invoice.
 */

import React from 'react';
import { Box, Heading, Inline, Stack, Text } from '@forge/react';
import {
  formatOccupancy,
  usedPercent,
  type MemoryHealth,
  type TableHealth,
} from '../pure/memoryHealth';
import { formatDate } from './format';
import { t, type Lang } from './i18n';

/** How many tables per line, so the panel stays small. */
const TABLES_PER_LINE = 4;

/** Splits a list into chunks of `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/** The age of the oldest failure, or "never". */
function oldestText(health: MemoryHealth, lang: Lang): string {
  if (health.oldestOccurrenceDays === undefined) return t('health.never', lang);
  return `${health.oldestOccurrenceDays} ${t('health.days', lang)}`;
}

/** The date of the last purge, or "never". */
function purgeText(health: MemoryHealth, lang: Lang): string {
  return health.lastPurgeAt ? formatDate(health.lastPurgeAt, lang) : t('health.never', lang);
}

/** The health of the memory, in four lines. */
export function HealthPanel(props: { lang: Lang; health: MemoryHealth }): React.JSX.Element {
  const { lang, health } = props;
  const occupancy = `${formatOccupancy(health.estimatedBytes)} / ${formatOccupancy(health.limitBytes)}`;
  return (
    <Stack space="space.050">
      <Heading size="small">{t('health.title', lang)}</Heading>
      <Inline space="space.200">
        <Text>{`${t('health.occupancy', lang)}: ${occupancy} (${usedPercent(health.estimatedBytes)}%)`}</Text>
        <Text>{`${t('health.rows', lang)}: ${health.totalRows}`}</Text>
      </Inline>
      <Inline space="space.200">
        <Text>{`${t('health.oldest', lang)}: ${oldestText(health, lang)}`}</Text>
        <Text>{`${t('health.lastPurge', lang)}: ${purgeText(health, lang)}`}</Text>
      </Inline>
      {chunk(health.tables, TABLES_PER_LINE).map((row) => (
        <Box key={row[0].table}>
          <Inline space="space.200">
            {row.map((table: TableHealth) => (
              <Text key={table.table}>{`${table.table}: ${table.rows}`}</Text>
            ))}
          </Inline>
        </Box>
      ))}
    </Stack>
  );
}
