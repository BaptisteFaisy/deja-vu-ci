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
import { Box, Button, Form, FormFooter, FormHeader, Heading, Inline, SectionMessage, Stack } from '@forge/react';
import { loadData } from './data';
import { t, type Lang } from './i18n';
import { SettingsFields, type SettingsPayload } from './settingsFields';
import { SaveFooter } from './settingsFooter';

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
        <SettingsFields lang={lang} settings={settings} onChange={update} />
        <SaveFooter lang={lang} onSave={() => void save()} onLang={setLang} />
      </Form>
      {status && <Box>{status}</Box>}
    </Stack>
  );
}
