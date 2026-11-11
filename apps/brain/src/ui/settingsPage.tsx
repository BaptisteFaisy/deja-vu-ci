/**
 * Page de réglages (§ 14, écran 5).
 *
 * Cinq réglages : le projet Jira où créer les tickets de problème, les seuils
 * d'instabilité (occurrences, branches, fenêtre), la conservation des extraits
 * bruts et la clé de l'entrée universelle.
 *
 * Les valeurs viennent du Cerveau par `invoke()` et y retournent par
 * `invoke()` : la page ne calcule aucun seuil.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Form,
  FormFooter,
  FormHeader,
  FormSection,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { loadData } from './data.js';
import { t, type Lang } from './i18n.js';

/** Réglages du projet Cerveau, tels que rendus par le serveur. */
interface SettingsPayload {
  issueProjectKey: string;
  flakyMinOccurrences: number;
  flakyMinBranches: number;
  flakyWindowDays: number;
  rawRetentionDays: number;
  universalKey?: string;
}

/** Réglages vides, avant chargement. */
const EMPTY: SettingsPayload = {
  issueProjectKey: '',
  flakyMinOccurrences: 3,
  flakyMinBranches: 2,
  flakyWindowDays: 14,
  rawRetentionDays: 30,
};

/** Page de réglages du Cerveau. */
export default function SettingsPage(): React.JSX.Element {
  const [lang, setLang] = useState<Lang>('en');
  const [settings, setSettings] = useState<SettingsPayload>(EMPTY);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    loadData<SettingsPayload>('settings')
      .then((value) => setSettings({ ...EMPTY, ...value }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const update = (patch: Partial<SettingsPayload>): void =>
    setSettings((current) => ({ ...current, ...patch }));

  const save = async (): Promise<void> => {
    try {
      await loadData<unknown>('save-settings', { ...settings });
      setStatus(t('settings.saved', lang));
      setError(undefined);
    } catch (cause: unknown) {
      setError(t('settings.saveFailed', lang));
      setStatus(undefined);
    }
  };

  if (error && !status) {
    return <SectionMessage appearance="error">{error}</SectionMessage>;
  }

  return (
    <Stack space="space.300">
      <Heading size="large">{t('settings.title', lang)}</Heading>
      <Form
        onSubmit={() => {
          void save();
        }}
      >
        <FormHeader />
        <FormSection>
          <Label labelFor="settings-project">{t('settings.project', lang)}</Label>
          <Textfield
            id="settings-project"
            value={settings.issueProjectKey}
            onChange={(event) => update({ issueProjectKey: event.target.value })}
          />
          <Label labelFor="settings-flaky-occurrences">
            {t('settings.flakyOccurrences', lang)}
          </Label>
          <Textfield
            id="settings-flaky-occurrences"
            type="number"
            value={String(settings.flakyMinOccurrences)}
            onChange={(event) => update({ flakyMinOccurrences: Number(event.target.value) })}
          />
          <Label labelFor="settings-flaky-branches">{t('settings.flakyBranches', lang)}</Label>
          <Textfield
            id="settings-flaky-branches"
            type="number"
            value={String(settings.flakyMinBranches)}
            onChange={(event) => update({ flakyMinBranches: Number(event.target.value) })}
          />
          <Label labelFor="settings-flaky-window">{t('settings.flakyWindow', lang)}</Label>
          <Textfield
            id="settings-flaky-window"
            type="number"
            value={String(settings.flakyWindowDays)}
            onChange={(event) => update({ flakyWindowDays: Number(event.target.value) })}
          />
          <Label labelFor="settings-retention">{t('settings.retention', lang)}</Label>
          <Textfield
            id="settings-retention"
            type="number"
            value={String(settings.rawRetentionDays)}
            onChange={(event) => update({ rawRetentionDays: Number(event.target.value) })}
          />
          <Label labelFor="settings-universal-key">{t('settings.universalKey', lang)}</Label>
          <Textfield
            id="settings-universal-key"
            value={settings.universalKey ?? ''}
            onChange={(event) => update({ universalKey: event.target.value })}
          />
          <Text>{t('settings.universalHint', lang)}</Text>
        </FormSection>
        <FormFooter>
          <Inline space="space.200">
            <Button appearance="primary" onClick={() => void save()}>
              {t('settings.save', lang)}
            </Button>
            <Button appearance="subtle" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}>
              {lang === 'en' ? 'Français' : 'English'}
            </Button>
          </Inline>
        </FormFooter>
      </Form>
      {status && <Box>{status}</Box>}
    </Stack>
  );
}
