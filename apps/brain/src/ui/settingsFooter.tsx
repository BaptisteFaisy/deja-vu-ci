/**
 * Pied de la page de réglages : enregistrer et changer de langue.
 *
 * Isolé de `settingsPage.tsx` pour que le composant de page reste sous la barre
 * des 50 lignes par fonction (règle user).
 */

import React from 'react';
import { Button, FormFooter, Inline } from '@forge/react';
import { t, type Lang } from './i18n';

export function SaveFooter(props: {
  lang: Lang;
  onSave: () => void;
  onLang: (lang: Lang) => void;
}): React.JSX.Element {
  const { lang, onSave, onLang } = props;
  return (
    <FormFooter>
      <Inline space="space.200">
        <Button appearance="primary" onClick={onSave}>
          {t('settings.save', lang)}
        </Button>
        <Button appearance="subtle" onClick={() => onLang(lang === 'en' ? 'fr' : 'en')}>
          {lang === 'en' ? 'Français' : 'English'}
        </Button>
      </Inline>
    </FormFooter>
  );
}
