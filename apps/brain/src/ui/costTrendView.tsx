/**
 * The daily cost trend of the Cost tab (§ 14, CI-14).
 *
 * The bars are **text**: each day is drawn with block characters scaled on the
 * widest day of the window, so the tab needs no chart library and no CSS of its
 * own. Every number comes from the engine's own cost report, assembled in
 * `src/pure/costTrend.ts` — this component only places the values.
 */

import React from 'react';
import { Box, Heading, Inline, Stack, Text } from '@forge/react';
import { textBar, trendMax, type CostTrend } from '../pure/costTrend';
import { formatDate } from './format';
import { t, type Lang } from './i18n';

/** The i18n key of the variation's direction. */
function directionKey(delta: number): string {
  if (delta > 0) return 'trend.up';
  if (delta < 0) return 'trend.down';
  return 'trend.flat';
}

/** One day of the series: the day, its bar, its minutes and its red builds. */
function TrendRow(props: {
  lang: Lang;
  day: string;
  bar: string;
  minutes: number;
  builds: number;
}): React.JSX.Element {
  return (
    <Inline space="space.100">
      <Text>{formatDate(`${props.day}T00:00:00.000Z`, props.lang)}</Text>
      <Text>{props.bar}</Text>
      <Text>{String(props.minutes)}</Text>
      <Text>{String(props.builds)}</Text>
    </Inline>
  );
}

/** The window total and its variation against the previous window. */
export function TrendSummary(props: {
  lang: Lang;
  trend: CostTrend;
}): React.JSX.Element {
  const { lang, trend } = props;
  const percent = trend.minutesDeltaPct === null ? '' : ` (${trend.minutesDeltaPct}%)`;
  const line = [
    `${t('column.minutes', lang)}: ${trend.current.ciMinutesLost}`,
    `${t('trend.builds', lang)}: ${trend.current.redBuilds}`,
    `${t(directionKey(trend.minutesDelta), lang)}${percent} ${t('trend.vsPrevious', lang)}`,
  ].join(' — ');
  return <Text>{line}</Text>;
}

/** The series of the window, or its explicit empty state. */
export function CostTrendView(props: {
  lang: Lang;
  trend?: CostTrend;
}): React.JSX.Element {
  const { lang, trend } = props;
  const empty = !trend || trend.points.every((point) => point.redBuilds === 0);
  if (empty) {
    return (
      <Box>
        <Heading size="small">{t('trend.title', lang)}</Heading>
        <Text>{t('trend.empty', lang)}</Text>
      </Box>
    );
  }
  const scale = Math.max(trendMax(trend), 1);
  return (
    <Stack space="space.050">
      <Heading size="small">{t('trend.title', lang)}</Heading>
      <TrendSummary lang={lang} trend={trend} />
      <Inline space="space.100">
        <Text>{t('trend.day', lang)}</Text>
        <Text>{t('column.minutes', lang)}</Text>
        <Text>{t('trend.builds', lang)}</Text>
      </Inline>
      {trend.points.map((point) => (
        <TrendRow
          key={point.day}
          lang={lang}
          day={point.day}
          bar={textBar(point.ciMinutesLost, scale)}
          minutes={point.ciMinutesLost}
          builds={point.redBuilds}
        />
      ))}
    </Stack>
  );
}
