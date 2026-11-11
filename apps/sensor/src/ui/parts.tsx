/**
 * Pieces shared by the two Custom UI screens of the Sensor.
 *
 * Plain React DOM — the Bitbucket modules of `@forge/manifest` declare no
 * `render` property, so UI Kit does not exist for them: the screens render
 * into the iframe's document with the repository's own styling
 * (`static/styles.css`). Kept apart so each screen stays short: the entry
 * point hands the language down, and the button that switches it is written
 * once.
 */

import React from 'react';
import { langToggleLabel, otherLang } from '@dejavu/present';
import type { Lang } from '@dejavu/present';

/** What the entry point (`src/ui/custom.tsx`) hands to every screen. */
export interface ScreenProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
}

/** The language button: it names the language it switches to. */
export function LanguageButton({ lang, onLang }: ScreenProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="dv-button dv-button--subtle"
      onClick={() => onLang(otherLang(lang))}
    >
      {langToggleLabel(lang)}
    </button>
  );
}
