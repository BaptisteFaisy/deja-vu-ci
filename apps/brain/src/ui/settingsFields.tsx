/**
 * Champs de la page de réglages (§ 14, écran 5).
 *
 * Une table décrit les champs : la projection Jira, les seuils d'instabilité,
 * la conservation des extraits bruts et la clé de l'entrée universelle. Le
 * composant ne fait que parcourir cette table — ajouter un réglage, c'est
 * ajouter une ligne, pas un bloc de JSX recopié.
 */

import React from 'react';
import { Box, Label, Text, Textfield } from '@forge/react';
import {
  DEFAULT_EXCERPT_POLICY,
  MINIMIZE_POLICIES,
  type MinimizePolicy,
} from '../pure/excerptPolicy';
import { LabeledRadio } from './pickers';
import type { Option } from './controls';
import { t, type Lang } from './i18n';

/** Réglages éditables, tels que la page les porte. */
export interface SettingsPayload {
  issueProjectKey: string;
  flakyMinOccurrences: number;
  flakyMinBranches: number;
  flakyWindowDays: number;
  rawRetentionDays: number;
  universalKey?: string;
  /** What the memory keeps of a raw failure (§ 18, CI-18). */
  excerptPolicy?: MinimizePolicy;
}

/** Un champ de la table : identifiant, libellé, clé, type. */
interface FieldSpec {
  id: string;
  labelKey: string;
  key: keyof SettingsPayload;
  numeric?: boolean;
  hintKey?: string;
}

/** La table des réglages, dans l'ordre d'affichage. */
const FIELDS: FieldSpec[] = [
  { id: 'settings-project', labelKey: 'settings.project', key: 'issueProjectKey' },
  {
    id: 'settings-flaky-occurrences',
    labelKey: 'settings.flakyOccurrences',
    key: 'flakyMinOccurrences',
    numeric: true,
  },
  {
    id: 'settings-flaky-branches',
    labelKey: 'settings.flakyBranches',
    key: 'flakyMinBranches',
    numeric: true,
  },
  {
    id: 'settings-flaky-window',
    labelKey: 'settings.flakyWindow',
    key: 'flakyWindowDays',
    numeric: true,
  },
  {
    id: 'settings-retention',
    labelKey: 'settings.retention',
    key: 'rawRetentionDays',
    numeric: true,
  },
  {
    id: 'settings-universal-key',
    labelKey: 'settings.universalKey',
    key: 'universalKey',
    hintKey: 'settings.universalHint',
  },
];

/** Les champs de réglages, rendus depuis la table. */
export function SettingsFields(props: {
  lang: Lang;
  settings: SettingsPayload;
  onChange: (patch: Partial<SettingsPayload>) => void;
}): React.JSX.Element {
  const { lang, settings, onChange } = props;
  return (
    <>
      {FIELDS.map((field) => {
        const value = settings[field.key];
        return (
          <React.Fragment key={field.id}>
            <Label labelFor={field.id}>{t(field.labelKey, lang)}</Label>
            <Textfield
              id={field.id}
              type={field.numeric ? 'number' : undefined}
              value={field.numeric ? String(value ?? 0) : String(value ?? '')}
              onChange={(event) =>
                onChange(
                  field.numeric
                    ? ({ [field.key]: Number(event.target.value) } as Partial<SettingsPayload>)
                    : ({ [field.key]: event.target.value } as Partial<SettingsPayload>),
                )
              }
            />
            {field.hintKey ? <Text>{t(field.hintKey, lang)}</Text> : null}
          </React.Fragment>
        );
      })}
      <ExcerptPolicyField
        lang={lang}
        value={settings.excerptPolicy}
        onChange={(policy) => onChange({ excerptPolicy: policy })}
      />
    </>
  );
}

/** The options of the retention policy, in the order the engine lists them. */
function policyOptions(lang: Lang): Option[] {
  return MINIMIZE_POLICIES.map((policy) => ({
    label: t(`policy.${policy}`, lang),
    value: policy,
  }));
}

/**
 * The retention policy of the raw excerpts (§ 18, CI-18).
 *
 * A radio group rather than a text field: the three policies are the engine's
 * own, and a typo here would silently widen what the memory keeps.
 */
export function ExcerptPolicyField(props: {
  lang: Lang;
  value?: MinimizePolicy;
  onChange: (policy: MinimizePolicy) => void;
}): React.JSX.Element {
  const { lang, value, onChange } = props;
  return (
    <Box>
      <LabeledRadio
        label={t('settings.excerptPolicy', lang)}
        name="settings-excerpt-policy"
        options={policyOptions(lang)}
        value={value ?? DEFAULT_EXCERPT_POLICY}
        onChange={(policy) => onChange(policy as MinimizePolicy)}
      />
      <Text>{t('settings.excerptHint', lang)}</Text>
    </Box>
  );
}
