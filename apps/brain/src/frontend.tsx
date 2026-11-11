/**
 * UI Kit 2 entry point of the Brain (`resources: main` in `manifest.yml`).
 *
 * Three Jira modules point at this one resource — the project page
 * ("CI Memory", § 14 screen 3), the issue panel (screen 4) and the project
 * settings page (screen 5). The platform tells which one is rendering through
 * `useProductContext().moduleKey`; the mapping lives in `src/pure/screens.ts`
 * and is unit-tested there.
 *
 * Each screen loads its own data through `invoke()` (`src/ui/data.ts`), so
 * this file only routes: while the context has not arrived, a spinner is
 * shown, and an unknown module key falls back on the project page instead of
 * rendering nothing.
 */

import React, { StrictMode } from 'react';
import ForgeReconciler, { Box, Spinner, Text, useProductContext } from '@forge/react';
import { normalizeLang } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { t } from './ui/i18n.js';
import IssueContext from './ui/issueContext.js';
import ProjectPage from './ui/projectPage.js';
import SettingsPage from './ui/settingsPage.js';
import { resolveScreen, type BrainScreen } from './pure/screens.js';

// The routing table is part of the entry point's contract: re-exported so a
// caller (or a test) can read it without importing the pure module.
export { resolveScreen };

/** Screen component of each declared module. */
const SCREENS: Record<BrainScreen, () => React.JSX.Element> = {
  projectPage: ProjectPage,
  issuePanel: IssueContext,
  settingsPage: SettingsPage,
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
  const lang = normalizeLang(context?.locale);
  if (context === undefined) return <Loading lang={lang} />;
  const Screen = SCREENS[resolveScreen(context.moduleKey)];
  return <Screen />;
}

ForgeReconciler.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
