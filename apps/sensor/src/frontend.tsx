/**
 * UI Kit 2 entry point of the Sensor (`resources: main` in `manifest.yml`).
 *
 * Both Bitbucket modules point at this one resource: the pull-request card
 * (§ 14, screen 1) and the workspace settings page (screen 2). The platform
 * says which one is rendering through `useProductContext().moduleKey`; the
 * mapping lives in `src/pure/screens.ts` and is unit-tested there.
 *
 * The language is read once here, from the product context locale, and handed
 * to the screens — so both screens speak the same language at the same time.
 */

import React, { StrictMode } from 'react';
import ForgeReconciler, { Box, Spinner, Text, useProductContext } from '@forge/react';
import { normalizeLang, t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { resolveScreen, type SensorScreen } from './pure/screens.js';
import PrCard from './ui/prCard.js';
import SettingsPage from './ui/settingsPage.js';
import type { ScreenProps } from './ui/parts.js';

// The routing table is part of the entry point's contract: re-exported so a
// caller (or a test) can read it without importing the pure module.
export { resolveScreen };

/** Screen component of each declared module. */
const SCREENS: Record<SensorScreen, (props: ScreenProps) => React.JSX.Element> = {
  prCard: PrCard,
  settings: SettingsPage,
};

/** Loading state: the platform context has not been handed over yet. */
function Loading({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <Box>
      <Spinner size="medium" />
      <Text>{t('common.loading', lang)}</Text>
    </Box>
  );
}

/** Routes the module key to the screen that renders it. */
export function App(): React.JSX.Element {
  const context = useProductContext();
  const [lang, setLang] = React.useState<Lang>(normalizeLang(context?.locale));
  if (context === undefined) return <Loading lang={lang} />;
  const Screen = SCREENS[resolveScreen(context.moduleKey)];
  return <Screen lang={lang} onLang={setLang} />;
}

ForgeReconciler.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
