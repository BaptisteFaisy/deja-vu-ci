/**
 * The "Incident in progress" panel of the CI Memory page (CI-15).
 *
 * One infrastructure incident, or one explicit empty line — never a ghost
 * block with blank fields. All the data is assembled server-side
 * (`src/pure/incident.ts`, through the `memory-page` resolver); this component
 * only places the values and translates the labels (`i18n.ts`).
 */

import React from 'react';
import { Box, Heading, Inline, SectionMessage, Stack, Tag, Text } from '@forge/react';
import type { IncidentPanel } from '../pure/incident';
import { formatDate } from './format';
import { t, type Lang } from './i18n';

/** One labelled line of the incident panel. */
function IncidentLine(props: { label: string; value: string }): React.JSX.Element {
  return (
    <Inline space="space.100">
      <Text>{props.label}</Text>
      <Text>{props.value}</Text>
    </Inline>
  );
}

/** The incident itself: families, repositories, window, ticket, start. */
export function IncidentDetails(props: {
  lang: Lang;
  incident: IncidentPanel;
}): React.JSX.Element {
  const { lang, incident } = props;
  return (
    <SectionMessage appearance="warning" title={t('incident.title', lang)}>
      <Stack space="space.050">
        <IncidentLine
          label={t('incident.family', lang)}
          value={`${incident.signatureShort} (${incident.familyId.slice(0, 8)})`}
        />
        <IncidentLine label={t('incident.repos', lang)} value={incident.repos.join(', ')} />
        <IncidentLine
          label={t('incident.window', lang)}
          value={`${incident.windowMinutes} min`}
        />
        <IncidentLine
          label={t('incident.started', lang)}
          value={formatDate(incident.startedAt, lang)}
        />
        <IncidentLine
          label={t('incident.failures', lang)}
          value={String(incident.occurrences)}
        />
        <Box>
          <Inline space="space.100">
            <Text>{t('incident.ticket', lang)}</Text>
            {incident.issueKey ? (
              <Tag color="purple" text={incident.issueKey} />
            ) : (
              <Text>{t('incident.noTicket', lang)}</Text>
            )}
          </Inline>
        </Box>
      </Stack>
    </SectionMessage>
  );
}

/** The panel: the running incident, or the explicit empty state. */
export function IncidentPanelView(props: {
  lang: Lang;
  incident?: IncidentPanel;
}): React.JSX.Element {
  const { lang, incident } = props;
  if (!incident) {
    return (
      <Box>
        <Heading size="small">{t('incident.title', lang)}</Heading>
        <Text>{t('incident.none', lang)}</Text>
      </Box>
    );
  }
  return <IncidentDetails lang={lang} incident={incident} />;
}
