/**
 * The workspace settings page (§ 14, screen 2).
 *
 * Three things, and only three: the pairing with a Brain (its web-trigger URL
 * and the shared secret, sent **once**), the repositories the Sensor watches,
 * and the maximum size of the excerpts it forwards.
 *
 * The secret is write-only: the field starts empty, `getSettings` answers
 * `paired` instead of the value, and nothing here ever prints it (§ 16, § 18).
 * The form is validated before it is posted (`src/pure/settingsView.ts`), and
 * the clamping of the excerpt size is the Sensor's, not the page's.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Form,
  FormFooter,
  FormHeader,
  Heading,
  Label,
  SectionMessage,
  Stack,
  Tag,
  Text,
  TextArea,
  Textfield,
} from '@forge/react';
import { formatBytes, t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import {
  clampExcerptBytes,
  emptySettingsView,
  formatRepositoryList,
  parseRepositoryList,
  validateSettingsForm,
  type SettingsForm,
  type SettingsView,
} from '../pure/settingsView';
import { loadData } from './data';
import { LanguageButton, type ScreenProps } from './parts';

/** The page's own state: everything is text until it is posted. */
interface FormState {
  brainUrl: string;
  secret: string;
  repositories: string;
  maxExcerptBytes: string;
}

const EMPTY_FORM: FormState = { brainUrl: '', secret: '', repositories: '', maxExcerptBytes: '' };

/** Builds the form out of what the resolver answered. */
export function formOf(view: SettingsView): FormState {
  return {
    brainUrl: view.brainUrl ?? '',
    // Never prefilled: the secret is not readable, not even by its owner.
    secret: '',
    repositories: formatRepositoryList(view.trackedRepositories),
    maxExcerptBytes: String(view.maxExcerptBytes),
  };
}

/** One labelled field: the label and the input stay together. */
function Field(props: {
  id: string;
  lang: Lang;
  labelKey: string;
  hintKey?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { id, lang, labelKey, hintKey, children } = props;
  return (
    <Box>
      <Label labelFor={id}>{t(labelKey, lang)}</Label>
      {children}
      {hintKey ? <Text>{t(hintKey, lang)}</Text> : null}
    </Box>
  );
}

/** The pairing: the Brain URL and the shared secret, sent once. */
function PairingFields(props: {
  lang: Lang;
  paired: boolean;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}): React.JSX.Element {
  const { lang, paired, form, onChange } = props;
  return (
    <Stack space="space.200">
      <Box>
        <Tag text={paired ? t('settings.paired', lang) : t('settings.notPaired', lang)} />
      </Box>
      <Field id="dejavu-brain-url" lang={lang} labelKey="settings.brainUrl">
        <Textfield
          id="dejavu-brain-url"
          value={form.brainUrl}
          onChange={(event) => onChange({ brainUrl: event.target.value })}
        />
      </Field>
      <Field id="dejavu-secret" lang={lang} labelKey="settings.secret" hintKey="settings.secretHint">
        <Textfield
          id="dejavu-secret"
          type="password"
          value={form.secret}
          onChange={(event) => onChange({ secret: event.target.value })}
        />
      </Field>
    </Stack>
  );
}

/** The watched repositories and the size of the excerpts. */
function WatchingFields(props: {
  lang: Lang;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}): React.JSX.Element {
  const { lang, form, onChange } = props;
  const bytes = clampExcerptBytes(Number(form.maxExcerptBytes));
  return (
    <Stack space="space.200">
      <Field id="dejavu-repositories" lang={lang} labelKey="settings.trackedRepositories">
        <TextArea
          id="dejavu-repositories"
          minimumRows={3}
          value={form.repositories}
          onChange={(event) => onChange({ repositories: event.target.value })}
        />
      </Field>
      <Field id="dejavu-max-excerpt" lang={lang} labelKey="settings.maxExcerpt">
        <Textfield
          id="dejavu-max-excerpt"
          type="number"
          value={form.maxExcerptBytes}
          onChange={(event) => onChange({ maxExcerptBytes: event.target.value })}
        />
      </Field>
      <Text>{formatBytes(bytes)}</Text>
    </Stack>
  );
}

/** The settings page of a Bitbucket workspace. */
export default function SettingsPage({ lang, onLang }: ScreenProps): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(emptySettingsView());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    loadData<SettingsView>('getSettings')
      .then((loaded) => {
        setView(loaded);
        setForm(formOf(loaded));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const onChange = (patch: Partial<FormState>): void =>
    setForm((current) => ({ ...current, ...patch }));

  const save = async (): Promise<void> => {
    const payload: SettingsForm = {
      brainUrl: form.brainUrl.trim(),
      trackedRepositories: parseRepositoryList(form.repositories),
      maxExcerptBytes: clampExcerptBytes(Number(form.maxExcerptBytes)),
    };
    // An empty secret means "leave the stored one alone".
    if (form.secret) payload.secret = form.secret;
    const invalid = validateSettingsForm(payload, view.paired);
    if (invalid) {
      setError(t(`settings.error.${invalid}`, lang));
      setStatus(undefined);
      return;
    }
    try {
      await loadData<unknown>('saveSettings', payload as unknown as Record<string, unknown>);
      setStatus(t('settings.saved', lang));
      setError(undefined);
      setForm({ ...formOf(view), ...payload, secret: '' } as FormState);
    } catch {
      setError(t('settings.saveFailed', lang));
      setStatus(undefined);
    }
  };

  return (
    <Stack space="space.300">
      <Heading size="large">{t('settings.title', lang)}</Heading>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {status ? <SectionMessage appearance="success">{status}</SectionMessage> : null}
      <Form
        onSubmit={() => {
          void save();
        }}
      >
        <FormHeader />
        <PairingFields lang={lang} paired={view.paired} form={form} onChange={onChange} />
        <WatchingFields lang={lang} form={form} onChange={onChange} />
        <FormFooter>
          <Button appearance="primary" onClick={() => void save()}>
            {t('settings.save', lang)}
          </Button>
          <LanguageButton lang={lang} onLang={onLang} />
        </FormFooter>
      </Form>
    </Stack>
  );
}
