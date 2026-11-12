/**
 * Le rendu du panneau « Sécurité » — quatre sections, aucun état produit ici.
 *
 * Les sections reçoivent l'état du panneau (texte saisi, enveloppe signée,
 * résultats déjà calculés) et une fonction `rerender` : un clic met à jour
 * l'état puis redemande un rendu, donc un changement de langue conserve tout.
 * Aucun `innerHTML` : les textes du moteur passent par `textContent`.
 */

import { badge, el, table } from '../render/dom';
import { t, type Lang } from '../lib/i18n';
import { REPO_URL } from '../render/sections';
import {
  BRIDGE_HEADERS,
  DEMO_SECRET,
  SUGGESTED_EXTRA,
  fakeSampleText,
  refusalScenarios,
  rotationDemo,
  runMaskDemo,
  sampleExcerpt,
  sbomRows,
  signDemo,
  verifyDemo,
  minimizationRows,
  type MaskDemo,
  type MinimizationRow,
  type RotationDemo,
  type SignedRequest,
} from './securite-demo';
import type { VerifyResult } from '../../../packages/bridge/src/index';

/** L'état interactif du panneau, conservé d'un rendu à l'autre. */
export interface SecuriteState {
  text: string;
  extraSource: string;
  extraKind: string;
  mask: MaskDemo | null;
  request: SignedRequest | null;
  scenarios: Record<string, VerifyResult>;
  rotation: RotationDemo | null;
}

/** L'état initial : l'exemple pré-rempli, rien de calculé. */
export function createState(): SecuriteState {
  return {
    text: fakeSampleText(),
    extraSource: SUGGESTED_EXTRA.source,
    extraKind: SUGGESTED_EXTRA.kind,
    mask: null,
    request: null,
    scenarios: {},
    rotation: null,
  };
}

/** Prépare ce qui est calculé une fois : masquage, signature, rotation. */
export function ensureReady(state: SecuriteState, now: Date): void {
  if (!state.mask) state.mask = runMaskDemo(state.text, state.extraSource, state.extraKind);
  if (!state.request) state.request = signDemo(DEMO_SECRET, now);
  if (!state.rotation) state.rotation = rotationDemo(now);
}

/** Un bloc de code brut (JSON, hexadécimal, journal). */
function raw(text: string): HTMLElement {
  return el('pre', { class: 'mono' }, text);
}

/** Le verdict d'une vérification : pastille + raison réelle du produit. */
function verdict(result: VerifyResult, lang: Lang): HTMLElement {
  if (result.ok) return badge(t('securite.bridge.accepted', lang), 'green');
  return el('span', {}, badge(t('securite.bridge.refused', lang), 'red'), ' ',
    el('span', { class: 'mono', text: result.reason }));
}

/* ------------------------------------------------------------------ */
/* 1. Masquage                                                         */
/* ------------------------------------------------------------------ */

/** Les pastilles des motifs qui ont touché (bleu) + le motif ajouté (violet). */
function kindsBadges(demo: MaskDemo): HTMLElement {
  const base = demo.base.kinds.map((kind) => badge(kind, 'blue'));
  const extra = (demo.withExtra?.kinds ?? [])
    .filter((kind) => !demo.base.kinds.includes(kind))
    .map((kind) => badge(kind, 'purple'));
  return el('span', {}, ...base, ...extra);
}

/** Le bloc « motifs par défaut conservés » + erreur de regex éventuelle. */
function extraNotes(demo: MaskDemo, lang: Lang): HTMLElement[] {
  const notes: HTMLElement[] = [];
  if (demo.error) {
    notes.push(el('p', { class: 'status error' }, `${t('securite.masking.badRegex', lang)} : ${demo.error}`));
  }
  if (demo.withExtra) {
    const kept = demo.base.kinds.every((kind) => demo.withExtra?.kinds.includes(kind));
    notes.push(
      el('p', {}, kept
        ? badge(t('securite.masking.defaultsKept', lang), 'green')
        : badge(t('securite.masking.defaultsLost', lang), 'red')),
    );
  } else if (!demo.error) {
    notes.push(el('p', { class: 'section-note' }, t('securite.masking.noExtra', lang)));
  }
  return notes;
}

/** Compteurs + textes masqués + résultats bruts. */
function maskResults(demo: MaskDemo, lang: Lang): HTMLElement {
  const counters = el(
    'ul',
    { class: 'counters' },
    el('li', {}, el('span', { class: 'value' }, String(demo.base.masked)),
      el('span', { class: 'label' }, t('securite.masking.base', lang))),
    el('li', {}, el('span', { class: 'value' }, String(demo.withExtra?.masked ?? 0)),
      el('span', { class: 'label' }, t('securite.masking.withExtra', lang))),
  );
  const shown = demo.withExtra ?? demo.base;
  return el(
    'div',
    {},
    counters,
    el('p', {}, t('securite.masking.kinds', lang), ' : ', kindsBadges(demo)),
    ...extraNotes(demo, lang),
    el('p', { class: 'section-note' }, t('securite.masking.maskedText', lang)),
    raw(shown.text),
    el('p', { class: 'section-note' }, t('securite.masking.raw', lang)),
    raw(JSON.stringify(demo, null, 2)),
  );
}

/** La zone de texte du masqueur, branchée sur l'état du panneau. */
function maskTextarea(lang: Lang, state: SecuriteState): HTMLTextAreaElement {
  const textarea = el('textarea', {
    rows: 10,
    class: 'mono',
    'aria-label': t('securite.masking.input', lang),
    oninput: (event) => {
      state.text = (event.target as HTMLTextAreaElement).value;
    },
  });
  textarea.value = state.text;
  return textarea;
}

/** Un champ texte court (motif supplémentaire, libellé), branché sur l'état. */
function maskInput(
  lang: Lang,
  key: string,
  size: number,
  value: string,
  onChange: (value: string) => void,
): HTMLInputElement {
  return el('input', {
    type: 'text',
    size,
    class: 'mono',
    value,
    'aria-label': t(key, lang),
    oninput: (event) => onChange((event.target as HTMLInputElement).value),
  });
}

/** La section masquage : zone de texte, motif supplémentaire, résultats. */
export function maskingSection(lang: Lang, state: SecuriteState, rerender: () => void): HTMLElement {
  const source = maskInput(lang, 'securite.masking.extraSource', 20, state.extraSource,
    (value) => {
      state.extraSource = value;
    });
  const kind = maskInput(lang, 'securite.masking.extraKind', 14, state.extraKind, (value) => {
    state.extraKind = value;
  });
  const run = () => {
    state.mask = runMaskDemo(state.text, state.extraSource, state.extraKind);
    rerender();
  };
  const reset = () => {
    state.text = fakeSampleText();
    state.extraSource = SUGGESTED_EXTRA.source;
    state.extraKind = SUGGESTED_EXTRA.kind;
    state.mask = runMaskDemo(state.text, state.extraSource, state.extraKind);
    rerender();
  };
  return el(
    'div',
    {},
    el('h2', {}, t('securite.masking.title', lang)),
    el('p', { class: 'section-note' }, t('securite.masking.note', lang)),
    el('p', {}, el('label', {}, t('securite.masking.input', lang))),
    maskTextarea(lang, state),
    el('p', {}, t('securite.masking.extraSource', lang), ' ', source, ' ',
      t('securite.masking.extraKind', lang), ' ', kind),
    el('p', {},
      el('button', { type: 'button', onclick: run }, t('securite.masking.run', lang)), ' ',
      el('button', { type: 'button', onclick: reset }, t('securite.masking.reset', lang))),
    state.mask ? maskResults(state.mask, lang) : el('p', { class: 'empty' }, '…'),
  );
}

/* ------------------------------------------------------------------ */
/* 2. Pont signé                                                       */
/* ------------------------------------------------------------------ */

/** Le tableau des en-têtes réels de la requête signée. */
function headersTable(request: SignedRequest, lang: Lang): HTMLElement {
  const rows = Object.entries(request.headers).map(([name, value]) => [
    el('span', { class: 'mono', text: name }),
    el('span', { class: 'mono', text: value }),
  ]);
  return table([t('securite.bridge.header', lang), t('securite.bridge.value', lang)], rows, '—');
}

/** Le tableau des six refus réels, un bouton par scénario. */
function refusalsTable(state: SecuriteState, lang: Lang, rerender: () => void): HTMLElement {
  const request = state.request;
  if (!request) return el('p', { class: 'empty' }, '…');
  const rows = refusalScenarios().map((scenario) => {
    const result = state.scenarios[scenario.id];
    return [
      t(scenario.labelKey, lang),
      el('button', {
        type: 'button',
        onclick: () => {
          state.scenarios[scenario.id] = scenario.run(request);
          rerender();
        },
      }, t('securite.bridge.try', lang)),
      result ? verdict(result, lang) : el('span', { class: 'mono', text: '—' }),
    ];
  });
  return table([t('securite.bridge.scenario', lang), '', t('securite.bridge.reason', lang)], rows, '—');
}

/** Le bloc rotation : trois cas vérifiés par le produit + l'ensemble tourné. */
function rotationBlock(rotation: RotationDemo, lang: Lang): HTMLElement {
  const rows: Array<[string, VerifyResult]> = [
    [t('securite.bridge.rotation.old', lang), rotation.oldAccepted],
    [t('securite.bridge.rotation.new', lang), rotation.newAccepted],
    [t('securite.bridge.rotation.after', lang), rotation.oldWithoutOverlap],
  ];
  return el(
    'div',
    {},
    el('h3', {}, t('securite.bridge.rotation', lang)),
    el('p', { class: 'section-note' }, t('securite.bridge.rotation.note', lang)),
    table([t('securite.bridge.rotation.case', lang), t('securite.bridge.reason', lang)],
      rows.map(([label, result]) => [label, verdict(result, lang)]), '—'),
    el('p', { class: 'section-note' }, t('securite.bridge.rotation.set', lang)),
    raw(JSON.stringify(rotation.set, null, 2)),
  );
}

/** La section pont signé : enveloppe, en-têtes, vérification, refus, rotation. */
export function bridgeSection(lang: Lang, state: SecuriteState, rerender: () => void): HTMLElement {
  const request = state.request;
  if (!request) return el('p', { class: 'empty' }, '…');
  const checked = verifyDemo(request);
  const facts = el(
    'ul',
    { class: 'facts' },
    el('li', {}, `${t('securite.bridge.secret', lang)} : `, el('span', { class: 'mono', text: DEMO_SECRET })),
    el('li', {}, `${t('securite.bridge.clock', lang)} : `,
      el('span', { class: 'mono', text: request.now.toISOString() })),
  );
  return el(
    'div',
    {},
    el('h2', {}, t('securite.bridge.title', lang)),
    el('p', { class: 'section-note' }, t('securite.bridge.note', lang)),
    facts,
    el('h3', {}, t('securite.bridge.headers', lang)),
    headersTable(request, lang),
    el('p', { class: 'section-note' }, t('securite.bridge.body', lang)),
    raw(request.body),
    el('h3', {}, t('securite.bridge.verify', lang)),
    el('p', {}, verdict(checked, lang)),
    checked.ok ? raw(JSON.stringify(checked.payload, null, 2)) : null,
    el('h3', {}, t('securite.bridge.refusals', lang)),
    refusalsTable(state, lang, rerender),
    state.rotation ? rotationBlock(state.rotation, lang) : null,
    el('p', {}, el('button', {
      type: 'button',
      onclick: () => {
        state.rotation = rotationDemo(request.now);
        rerender();
      },
    }, t('securite.bridge.rotation.run', lang))),
  );
}

/* ------------------------------------------------------------------ */
/* 3. Minimisation                                                     */
/* ------------------------------------------------------------------ */

/** La cellule « ce qui est stocké » : rien, ou le texte avec son état. */
function storedCell(row: MinimizationRow, lang: Lang): HTMLElement {
  const { engine } = row;
  if (engine.text === undefined) {
    return el('span', { class: 'section-note' }, t('securite.minimize.nothing', lang));
  }
  return el(
    'div',
    {},
    badge(engine.truncated ? t('securite.minimize.truncated', lang) : t('securite.minimize.kept', lang),
      engine.truncated ? 'yellow' : 'green'),
    raw(engine.text),
  );
}

/** La section minimisation : extrait source + les trois politiques. */
export function minimizeSection(lang: Lang): HTMLElement {
  const rows = minimizationRows().map((row) => [
    el('span', { class: 'mono', text: row.policy }),
    el('span', { class: 'mono', text: row.engine.fingerprint }),
    storedCell(row, lang),
    String(row.engine.bytes),
    String(row.brain.bytes),
    row.agree ? badge('OK', 'green') : badge('KO', 'red'),
  ]);
  return el(
    'div',
    {},
    el('h2', {}, t('securite.minimize.title', lang)),
    el('p', { class: 'section-note' }, t('securite.minimize.note', lang)),
    el('p', { class: 'section-note' }, t('securite.minimize.source', lang)),
    raw(sampleExcerpt()),
    table(
      [t('securite.minimize.policy', lang), t('securite.minimize.fingerprint', lang),
        t('securite.minimize.stored', lang), `${t('securite.minimize.bytes', lang)} (core)`,
        `${t('securite.minimize.bytes', lang)} (brain)`, t('securite.minimize.agree', lang)],
      rows,
      '—',
    ),
  );
}

/* ------------------------------------------------------------------ */
/* 4. Inventaire (SBOM)                                                */
/* ------------------------------------------------------------------ */

/** Les quatre liens vers les documents de sécurité du dépôt. */
function docsLinks(lang: Lang): HTMLElement {
  const link = (path: string, key: string) =>
    el('a', { href: `${REPO_URL}/blob/main/${path}`, rel: 'noopener' }, t(key, lang));
  return el(
    'p',
    {},
    `${t('securite.sbom.docs', lang)} : `,
    link('docs/THREAT-MODEL.md', 'securite.sbom.threat'), ' · ',
    link('SECURITY.md', 'securite.sbom.policy'), ' · ',
    link('docs/THIRD-PARTY.md', 'securite.sbom.thirdparty'), ' · ',
    link('docs/SBOM.json', 'securite.sbom.file'),
  );
}

/** La section inventaire : le SBOM réel rendu en tableau. */
export function sbomSection(lang: Lang): HTMLElement {
  const rows = sbomRows().map((row) => [
    el('span', { class: 'mono', text: row.name }),
    el('span', { class: 'mono', text: row.version }),
    row.licenses ? row.licenses : el('span', { class: 'section-note' }, t('securite.sbom.undeclared', lang)),
    badge(row.firstParty ? t('securite.sbom.firstParty', lang) : t('securite.sbom.thirdParty', lang),
      row.firstParty ? 'blue' : 'grey'),
  ]);
  return el(
    'div',
    {},
    el('h2', {}, t('securite.sbom.title', lang)),
    el('p', { class: 'section-note' }, t('securite.sbom.note', lang)),
    table(
      [t('securite.sbom.component', lang), t('securite.sbom.version', lang),
        t('securite.sbom.license', lang), t('securite.sbom.origin', lang)],
      rows,
      '—',
    ),
    docsLinks(lang),
  );
}
