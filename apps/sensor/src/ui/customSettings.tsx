/**
 * The workspace settings page, Custom UI flavour (§ 14, screen 2).
 *
 * Three things, and only three: the pairing with a Brain (its web-trigger URL
 * and the shared secret, sent **once**), the repositories the Sensor watches,
 * and the maximum size of the excerpts it forwards.
 *
 * The secret is write-only: the field starts empty, `getSettings` answers
 * `paired` instead of the value, and nothing here ever prints it (§ 16, § 18).
 * The form is validated before it is posted and the page's state machine
 * lives in `useSettings`; every rule it applies is pure and unit-tested
 * (`src/pure/settingsView.ts`).
 */

import React, { useEffect, useState } from 'react';
import { formatBytes, t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import {
  EMPTY_SETTINGS_FORM,
  clampExcerptBytes,
  emptySettingsView,
  formOf,
  payloadOf,
  validateSettingsForm,
  viewAfterSave,
  type SettingsFormState,
  type SettingsView,
} from '../pure/settingsView';
import { loadData } from './data';
import { LanguageButton, type ScreenProps } from './parts';

/** What `saveSettings` answers: never a thrown error, always a verdict. */
interface SaveAnswer {
  ok: boolean;
  error?: string;
}

/**
 * Posts the form: local validation first, then the resolver's verdict.
 *
 * Returns the optimistic view on success, or the message to display — the
 * page never shows a raw rejection.
 */
async function submitSettings(
  form: SettingsFormState,
  view: SettingsView,
  lang: Lang,
): Promise<{ saved?: SettingsView; error?: string }> {
  const payload = payloadOf(form);
  const invalid = validateSettingsForm(payload, view.paired);
  if (invalid) return { error: t(`settings.error.${invalid}`, lang) };
  try {
    const answer = await loadData<SaveAnswer>('saveSettings', payload as Record<string, unknown>);
    if (!answer || answer.ok === false) {
      return { error: answer?.error || t('settings.saveFailed', lang) };
    }
    return { saved: viewAfterSave(view, payload) };
  } catch {
    return { error: t('settings.saveFailed', lang) };
  }
}

/** The page's state machine: load, edit, validate, post, confirm. */
function useSettings(lang: Lang) {
  const [view, setView] = useState<SettingsView>(emptySettingsView());
  const [form, setForm] = useState<SettingsFormState>(EMPTY_SETTINGS_FORM);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData<SettingsView>('getSettings')
      .then((loaded) => {
        setView(loaded);
        setForm(formOf(loaded));
        if (!loaded.ok && loaded.error) setError(loaded.error);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const onChange = (patch: Partial<SettingsFormState>): void =>
    setForm((current) => ({ ...current, ...patch }));

  const save = async (): Promise<void> => {
    setSaving(true);
    const outcome = await submitSettings(form, view, lang);
    setSaving(false);
    if (outcome.saved) {
      setView(outcome.saved);
      setForm(formOf(outcome.saved));
      setStatus(t('settings.saved', lang));
      setError(undefined);
    } else {
      setError(outcome.error);
      setStatus(undefined);
    }
  };

  return { view, form, status, error, saving, onChange, save };
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
    <div className="dv-field">
      <label htmlFor={id}>{t(labelKey, lang)}</label>
      {children}
      {hintKey ? <span className="dv-hint">{t(hintKey, lang)}</span> : null}
    </div>
  );
}

/** The pairing: the Brain URL and the shared secret, sent once. */
function PairingFields(props: {
  lang: Lang;
  paired: boolean;
  form: SettingsFormState;
  onChange: (patch: Partial<SettingsFormState>) => void;
}): React.JSX.Element {
  const { lang, paired, form, onChange } = props;
  return (
    <div className="dv-stack">
      <span className={`dv-tag ${paired ? 'dv-tag--green' : 'dv-tag--grey'}`}>
        {paired ? t('settings.paired', lang) : t('settings.notPaired', lang)}
      </span>
      <Field id="dejavu-brain-url" lang={lang} labelKey="settings.brainUrl">
        <input
          id="dejavu-brain-url"
          type="url"
          value={form.brainUrl}
          onChange={(event) => onChange({ brainUrl: event.target.value })}
        />
      </Field>
      <Field id="dejavu-secret" lang={lang} labelKey="settings.secret" hintKey="settings.secretHint">
        <input
          id="dejavu-secret"
          type="password"
          autoComplete="off"
          value={form.secret}
          onChange={(event) => onChange({ secret: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** The watched repositories and the size of the excerpts. */
function WatchingFields(props: {
  lang: Lang;
  form: SettingsFormState;
  onChange: (patch: Partial<SettingsFormState>) => void;
}): React.JSX.Element {
  const { lang, form, onChange } = props;
  const bytes = clampExcerptBytes(Number(form.maxExcerptBytes));
  return (
    <div className="dv-stack">
      <Field id="dejavu-repositories" lang={lang} labelKey="settings.trackedRepositories">
        <textarea
          id="dejavu-repositories"
          rows={3}
          value={form.repositories}
          onChange={(event) => onChange({ repositories: event.target.value })}
        />
      </Field>
      <Field id="dejavu-max-excerpt" lang={lang} labelKey="settings.maxExcerpt">
        <input
          id="dejavu-max-excerpt"
          type="number"
          min={1}
          step={1}
          value={form.maxExcerptBytes}
          onChange={(event) => onChange({ maxExcerptBytes: event.target.value })}
        />
      </Field>
      <span className="dv-hint">{formatBytes(bytes)}</span>
    </div>
  );
}

/** The page: the state machine above, the fields below. */
export default function SettingsPage({ lang, onLang }: ScreenProps): React.JSX.Element {
  const { view, form, status, error, saving, onChange, save } = useSettings(lang);
  return (
    <div className="dv-card dv-page">
      <h1 className="dv-heading">{t('settings.title', lang)}</h1>
      {error ? <p className="dv-message dv-message--error">{error}</p> : null}
      {status ? <p className="dv-message dv-message--success">{status}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <PairingFields lang={lang} paired={view.paired} form={form} onChange={onChange} />
        <WatchingFields lang={lang} form={form} onChange={onChange} />
        <div className="dv-row dv-footer">
          <button type="submit" className="dv-button" disabled={saving}>
            {t('settings.save', lang)}
          </button>
          <LanguageButton lang={lang} onLang={onLang} />
        </div>
      </form>
    </div>
  );
}
