/**
 * Custom UI entry point of the Sensor (`resources: main` → `static/`).
 *
 * The Bitbucket modules of `@forge/manifest` declare no `render` property:
 * UI Kit does not exist for Bitbucket. A Bitbucket UI module is a **Custom
 * UI** — a static folder (`index.html` + assets) served in an iframe, which
 * talks to the backend through `invoke()` of `@forge/bridge`. `forge lint`
 * refuses anything else ("Custom UI resource must be a directory").
 *
 * Both modules share this one bundle: the platform says which one is
 * rendering through `view.getContext().moduleKey`, and the mapping lives in
 * `src/pure/screens.ts` (unit-tested there). The language is read from the
 * context locale and handed to the screens, so both speak the same language
 * at the same time.
 *
 * The bundle is **committed** (`static/index.js`) so `forge deploy` needs no
 * build tooling; regenerate it with `npm run build:ui` (see the README).
 */

import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { normalizeLang, t } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import { resolveScreen } from '../pure/screens';
import PrCard from './customPrCard';
import SettingsPage from './customSettings';
import type { ScreenProps } from './parts';

// The routing table is part of the entry point's contract: re-exported so a
// caller (or a test) can read it without importing the pure module.
export { resolveScreen };

/** The two things the screens need out of the platform context. */
interface UiContext {
  moduleKey: string;
  locale: string;
}

/** Reads the context once; outside Forge it degrades to the default screen. */
function useUiContext(): UiContext | undefined {
  const [context, setContext] = useState<UiContext | undefined>();
  useEffect(() => {
    view
      .getContext()
      .then((full) => setContext({ moduleKey: full.moduleKey ?? '', locale: full.locale ?? '' }))
      .catch(() => setContext({ moduleKey: '', locale: '' }));
  }, []);
  return context;
}

/** Routes the module key to the screen that renders it. */
export function App(): React.JSX.Element {
  const context = useUiContext();
  const [lang, setLang] = useState<Lang>(() =>
    normalizeLang(typeof navigator === 'undefined' ? undefined : navigator.language),
  );
  useEffect(() => {
    if (context) setLang(normalizeLang(context.locale));
  }, [context]);

  if (context === undefined) {
    return <p className="dv-muted">{t('common.loading', lang)}</p>;
  }
  const Screen: (props: ScreenProps) => React.JSX.Element =
    resolveScreen(context.moduleKey) === 'settings' ? SettingsPage : PrCard;
  return <Screen lang={lang} onLang={setLang} />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
