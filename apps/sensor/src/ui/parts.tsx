/**
 * Pieces shared by the two screens of the Sensor.
 *
 * Kept apart so each screen stays short: the entry point hands the language
 * down, and the button that switches it is written once.
 */

import React from 'react';
import { Button } from '@forge/react';
import { langToggleLabel, otherLang } from '@dejavu/present';
import type { Lang } from '@dejavu/present';

/** What the entry point (`src/frontend.tsx`) hands to every screen. */
export interface ScreenProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
}

/** The language button: it names the language it switches to. */
export function LanguageButton({ lang, onLang }: ScreenProps): React.JSX.Element {
  return (
    <Button appearance="subtle" onClick={() => onLang(otherLang(lang))}>
      {langToggleLabel(lang)}
    </Button>
  );
}
