/**
 * Panneau « Votre erreur » — le diagnostic d'un log collé.
 *
 * Le visiteur colle un journal de build en échec (ou clique sur un des huit
 * exemples, un par écosystème), et la **chaîne réelle** se déroule sous ses
 * yeux : masquage, extraction, signature (confrontée à la mémoire partagée du
 * rejeu), diagnostic. Chaque étape est repliable et montre son résultat brut
 * en JSON — calculé dans le navigateur par `packages/core`, jamais mis en
 * scène. Toute la logique vit dans le module pur `erreur-analyse.ts` ; ce
 * fichier ne fait que placer des données.
 */

import {
  actionLabel,
  categoryLabel,
  diagnosticLabel,
  diagnosticTone,
  formatConfidence,
  formatDate,
  statusLabel,
  statusTone,
} from '@dejavu/present';
import type { ErrorBlock, ExtractSource } from '@dejavu/core';
import { badge, el, mount, type Child } from '../render/dom';
import { fill, registerStrings, t, type Lang } from '../lib/i18n';
import { SAMPLES } from './erreur-samples';
import {
  analyzePastedLog,
  type DiagnoseStep,
  type ErrorAnalysis,
  type SignatureStep,
} from './erreur-analyse';
import type { Panel, PanelContext } from './types';

registerStrings({
  'panel.erreur.title': ['Your error', 'Votre erreur'],
  'panel.erreur.summary': [
    'Paste a failing log: the engine masks the secrets, extracts the error, signs it and answers with a diagnostic.',
    'Collez un journal en échec : le moteur masque les secrets, extrait l’erreur, la signe et répond par un diagnostic.',
  ],
  'erreur.note': [
    'Everything below runs in your browser with the real engine (`packages/core`). The memory ' +
      'consulted at step 3 is the one filled by the sample replay — a signature already seen ' +
      'there is recognised here, exactly as in the app.',
    'Tout ce qui suit tourne dans votre navigateur avec le vrai moteur (`packages/core`). La ' +
      'mémoire consultée à l’étape 3 est celle remplie par le rejeu d’exemple — une signature ' +
      'déjà vue là-bas est reconnue ici, exactement comme dans l’app.',
  ],
  'erreur.input.label': ['Your failing build log', 'Votre journal de build en échec'],
  'erreur.input.placeholder': [
    'Paste a failing build log here (CI output, test report)…',
    'Collez ici un journal de build en échec (sortie de CI, rapport de tests)…',
  ],
  'erreur.run': ['Diagnose', 'Diagnostiquer'],
  'erreur.running': ['Analysing with the real engine…', 'Analyse avec le vrai moteur…'],
  'erreur.samples': ['Or try a sample — one per ecosystem:', 'Ou essayez un exemple — un par écosystème :'],
  'erreur.sample.maven': ['Maven / JUnit (Java)', 'Maven / JUnit (Java)'],
  'erreur.sample.pytest': ['pytest (Python)', 'pytest (Python)'],
  'erreur.sample.jest': ['jest / vitest (JS)', 'jest / vitest (JS)'],
  'erreur.sample.go': ['go test (Go)', 'go test (Go)'],
  'erreur.sample.rust': ['cargo test (Rust)', 'cargo test (Rust)'],
  'erreur.sample.dotnet': ['.NET (xUnit)', '.NET (xUnit)'],
  'erreur.sample.docker': ['Docker / network', 'Docker / réseau'],
  'erreur.sample.npm': ['npm (401 + token)', 'npm (401 + jeton)'],
  'erreur.step.mask': ['1 — Masking: secrets erased at the door', '1 — Masquage : les secrets effacés à l’entrée'],
  'erreur.step.extract': ['2 — Extraction: the engine recognises the error', '2 — Extraction : le moteur reconnaît l’erreur'],
  'erreur.step.signature': ['3 — Signature: a fingerprint checked against the memory', '3 — Signature : une empreinte confrontée à la mémoire'],
  'erreur.step.diagnose': ['4 — Diagnosis: the verdict, its facts, the action', '4 — Diagnostic : le verdict, ses faits, l’action'],
  'erreur.masked.count': ['{n} secret(s) masked.', '{n} secret(s) masqué(s).'],
  'erreur.masked.none': ['No secret detected in this text.', 'Aucun secret détecté dans ce texte.'],
  'erreur.mask.kinds': ['Pattern families hit:', 'Familles de motifs touchées :'],
  'erreur.mask.text': ['Masked text — what the engine actually sees:', 'Texte masqué — ce que le moteur voit réellement :'],
  'erreur.source.report': ['test report (ecosystem parser)', 'rapport de tests (parseur d’écosystème)'],
  'erreur.source.log': ['log patterns', 'motifs de journal'],
  'erreur.source.tail': ['log tail (no pattern recognised)', 'fin de journal (aucun motif reconnu)'],
  'erreur.ecosystems': ['Ecosystem parsers that recognised this log:', 'Parseurs d’écosystèmes ayant reconnu ce journal :'],
  'erreur.ecosystems.none': [
    'No ecosystem parser recognised this log: extraction fell back to log patterns.',
    'Aucun parseur d’écosystème n’a reconnu ce journal : l’extraction se replie sur les motifs.',
  ],
  'erreur.blocks': ['{n} error block(s) extracted, source: ', '{n} bloc(s) d’erreur extrait(s), source : '],
  'erreur.dropped': ['{d} block(s) dropped — the engine keeps at most 3.', '{d} bloc(s) écarté(s) — le moteur en garde 3 au plus.'],
  'erreur.block.title': ['Block {i}', 'Bloc {i}'],
  'erreur.errorType': ['Error type', 'Type d’erreur'],
  'erreur.message': ['Message', 'Message'],
  'erreur.frames': ['Project stack frames:', 'Frames de pile du projet :'],
  'erreur.frames.none': ['No project frame recognised.', 'Aucune frame du projet reconnue.'],
  'erreur.known': ['Already in memory', 'Déjà en mémoire'],
  'erreur.unknown': ['Unknown — first appearance', 'Inconnue — première apparition'],
  'erreur.family': ['Family', 'Famille'],
  'erreur.diagnose.context': [
    'Honesty: the diagnosed occurrence is synthetic (built from your text — repository ' +
      '“pasted-log”, commit “unknown”); the history comes from the shared replay memory; the ' +
      'settings are the product defaults.',
    'Honnêteté : l’occurrence diagnostiquée est synthétique (construite depuis votre texte — ' +
      'dépôt « pasted-log », commit « unknown ») ; l’historique vient de la mémoire partagée du ' +
      'rejeu ; les réglages sont ceux par défaut du produit.',
  ],
  'erreur.history': [
    'Memory history: {n} occurrence(s) of this signature, {m} of this family.',
    'Historique en mémoire : {n} occurrence(s) de cette signature, {m} de cette famille.',
  ],
  'erreur.action': ['Recommended action:', 'Action recommandée :'],
  'erreur.confidence': ['Confidence:', 'Confiance :'],
  'erreur.evidence': ['Raw evidence:', 'Preuves brutes :'],
  'erreur.empty': [
    'No error block recognised in this text. The engine never guesses: paste a real failing ' +
      'log, or try one of the samples.',
    'Aucun bloc d’erreur reconnu dans ce texte. Le moteur ne devine jamais : collez un vrai ' +
      'journal d’échec, ou essayez un des exemples.',
  ],
  'erreur.hint': [
    'Paste a log or pick a sample, then click « Diagnose »: the four steps unfold with their raw results.',
    'Collez un journal ou choisissez un exemple, puis cliquez sur « Diagnostiquer » : les quatre étapes se déroulent avec leurs résultats bruts.',
  ],
  'erreur.raw': ['Raw result (JSON) — computed in your browser:', 'Résultat brut (JSON) — calculé dans votre navigateur :'],
  'erreur.failed': ['The analysis failed: {message}', 'L’analyse a échoué : {message}'],
});

/** Clé de libellé par source d'extraction (les trois valeurs du contrat). */
const SOURCE_KEYS: Record<ExtractSource, string> = {
  report: 'erreur.source.report',
  log: 'erreur.source.log',
  tail: 'erreur.source.tail',
};

/**
 * L'état propre du panneau : le brouillon collé et la dernière analyse.
 * Il survit aux re-rendus de la coque (changement de langue, `notify()`),
 * donc un visiteur ne perd jamais son texte en changeant d'onglet.
 */
interface Draft {
  text: string;
  analysis?: ErrorAnalysis;
  running: boolean;
  error?: string;
}

const draft: Draft = { text: '', running: false };

/** Un bloc repliable d'étape : titre en `<summary>`, note puis contenu. */
function step(key: string, lang: Lang, open: boolean, ...content: Child[]): HTMLElement {
  return el(
    'details',
    { open },
    el('summary', {}, el('strong', {}, t(key, lang))),
    ...content,
  );
}

/** Le résultat brut d'une étape : JSON intégral dans un `<pre class="mono">`.
 * Style en ligne : `styles.css` est partagé (interdit), et un JSON long doit
 * rester lisible — d'où le défilement horizontal. */
const PRE_STYLE = 'overflow-x: auto; max-width: 100%;';

function jsonPre(value: unknown, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('erreur.raw', lang)),
    el('pre', { class: 'mono', style: PRE_STYLE }, JSON.stringify(value, null, 2)),
  );
}

/** Une ligne de fait « libellé : valeur », en liste `.facts`. */
function facts(entries: Array<[string, Child]>): HTMLElement {
  return el(
    'ul',
    { class: 'facts' },
    ...entries.map(([label, value]) => el('li', {}, `${label}: `, value)),
  );
}

/** Étape 1 — masquage : texte masqué, nombre de secrets, familles touchées. */
function maskSection(analysis: ErrorAnalysis, lang: Lang): HTMLElement {
  const { mask } = analysis;
  return step(
    'erreur.step.mask',
    lang,
    true,
    el(
      'p',
      {},
      fill(t(mask.masked > 0 ? 'erreur.masked.count' : 'erreur.masked.none', lang), {
        n: mask.masked,
      }),
      mask.kinds.length > 0
        ? el('span', {}, ` ${t('erreur.mask.kinds', lang)} `, ...mask.kinds.map((kind) => badge(kind, 'red')))
        : null,
    ),
    el('p', { class: 'section-note' }, t('erreur.mask.text', lang)),
    el('pre', { class: 'mono', style: PRE_STYLE }, mask.text),
    jsonPre({ masked: mask.masked, kinds: mask.kinds, text: mask.text }, lang),
  );
}

/** La carte d'un bloc extrait : catégorie, type, message, test, pile. */
function blockCard(block: ErrorBlock, index: number, lang: Lang): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, fill(t('erreur.block.title', lang), { i: index + 1 })),
    facts([
      [t('col.category', lang), categoryLabel(block.category, lang)],
      [t('erreur.errorType', lang), el('span', { class: 'mono' }, block.errorType)],
      [t('erreur.message', lang), block.message],
      [t('col.test', lang), el('span', { class: 'mono' }, block.testName ?? '—')],
    ]),
    el('p', { class: 'section-note' }, block.frames.length > 0 ? t('erreur.frames', lang) : t('erreur.frames.none', lang)),
    block.frames.length > 0
      ? el(
          'ul',
          { class: 'facts' },
          ...block.frames.map((frame) =>
            el('li', { class: 'mono' }, `${frame.file}:${frame.line ?? '?'}${frame.fn ? ` ${frame.fn}` : ''}`),
          ),
        )
      : null,
  );
}

/** Étape 2 — extraction : source, écosystèmes reconnus, blocs. */
function extractSection(analysis: ErrorAnalysis, lang: Lang): HTMLElement {
  const { extract } = analysis;
  return step(
    'erreur.step.extract',
    lang,
    true,
    el(
      'p',
      {},
      fill(t('erreur.blocks', lang), { n: extract.blocks.length }),
      badge(t(SOURCE_KEYS[extract.source], lang), 'blue'),
      extract.dropped > 0 ? el('span', {}, ` ${fill(t('erreur.dropped', lang), { d: extract.dropped })}`) : null,
    ),
    el(
      'p',
      { class: 'section-note' },
      extract.ecosystems.length > 0 ? t('erreur.ecosystems', lang) : t('erreur.ecosystems.none', lang),
      ...extract.ecosystems.map((name) => badge(name, 'green')),
    ),
    el('div', { class: 'cards' }, ...extract.blocks.map((block, index) => blockCard(block, index, lang))),
    jsonPre({ source: extract.source, dropped: extract.dropped, ecosystems: extract.ecosystems, blocks: extract.blocks }, lang),
  );
}

/** La carte mémoire d'une signature : connue (statut, compte) ou inconnue. */
function signatureCard(item: SignatureStep, lang: Lang): HTMLElement {
  const known = item.known;
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, el('span', { class: 'mono' }, item.short), ' ', el('span', { class: 'mono' }, item.signature)),
    known
      ? badge(t('erreur.known', lang), 'green')
      : badge(t('erreur.unknown', lang), 'yellow'),
    facts([
      [t('col.signature', lang), el('span', { class: 'mono' }, item.signature)],
      [t('erreur.family', lang), el('span', { class: 'mono' }, item.family)],
      ...(known
        ? ([
            [t('col.status', lang), badge(statusLabel(known.status, lang), statusTone(known.status))],
            [t('col.occurrences', lang), String(known.occurrences)],
            [t('col.firstSeen', lang), formatDate(known.firstSeen, lang)],
            [t('col.lastSeen', lang), formatDate(known.lastSeen, lang)],
            [t('col.ticket', lang), el('span', { class: 'mono' }, known.issueKey ?? '—')],
          ] as Array<[string, Child]>)
        : []),
    ]),
  );
}

/** Étape 3 — signature : empreintes et confrontation à la mémoire. */
function signatureSection(analysis: ErrorAnalysis, lang: Lang): HTMLElement {
  return step(
    'erreur.step.signature',
    lang,
    true,
    el('div', { class: 'cards' }, ...analysis.signatures.map((item) => signatureCard(item, lang))),
    jsonPre(analysis.signatures, lang),
  );
}

/** La carte d'un diagnostic : verdict, faits, action, confiance, preuves. */
function diagnosticCard(item: DiagnoseStep, lang: Lang): HTMLElement {
  const diagnostic = item.diagnostic;
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, badge(diagnosticLabel(diagnostic.kind, lang), diagnosticTone(diagnostic.kind)), ' ', diagnostic.title),
    el('p', {}, diagnostic.summary),
    el(
      'p',
      {},
      `${t('erreur.action', lang)} `,
      badge(actionLabel(diagnostic.action, lang), 'blue'),
      ` ${t('erreur.confidence', lang)} `,
      el('span', { class: 'mono' }, formatConfidence(diagnostic.confidence)),
    ),
    el('p', { class: 'section-note' }, fill(t('erreur.history', lang), {
      n: item.history.length,
      m: item.familyHistory.length,
    })),
    el('ul', { class: 'facts' }, ...diagnostic.facts.map((fact) => el('li', {}, `${fact.label}: ${fact.value}`))),
    diagnostic.evidence && diagnostic.evidence.length > 0
      ? el(
          'div',
          {},
          el('p', { class: 'section-note' }, t('erreur.evidence', lang)),
          el('ul', { class: 'facts' }, ...diagnostic.evidence.map((line) => el('li', { class: 'mono' }, line))),
        )
      : null,
  );
}

/** Étape 4 — diagnostic : contexte synthétique assumé, verdicts réels. */
function diagnoseSection(analysis: ErrorAnalysis, lang: Lang): HTMLElement {
  return step(
    'erreur.step.diagnose',
    lang,
    true,
    el('p', { class: 'section-note' }, t('erreur.diagnose.context', lang)),
    el('div', { class: 'cards' }, ...analysis.diagnoses.map((item) => diagnosticCard(item, lang))),
    jsonPre(analysis.diagnoses, lang),
  );
}

/** Les quatre étapes, ou l'état vide explicite — jamais de diagnostic inventé. */
function resultsOf(analysis: ErrorAnalysis | undefined, lang: Lang): Child[] {
  if (draft.error) {
    return [el('p', { class: 'status error' }, fill(t('erreur.failed', lang), { message: draft.error }))];
  }
  if (!analysis) return [el('p', { class: 'empty' }, t('erreur.hint', lang))];
  const sections: Child[] = [maskSection(analysis, lang)];
  if (analysis.extract.blocks.length === 0) {
    sections.push(el('p', { class: 'empty' }, t('erreur.empty', lang)));
    return sections;
  }
  sections.push(
    extractSection(analysis, lang),
    signatureSection(analysis, lang),
    diagnoseSection(analysis, lang),
  );
  return sections;
}

/** Lance l'analyse (bouton « Diagnostiquer ») : synchrone côté visiteur, sans réseau. */
async function runAnalysis(ctx: PanelContext, results: HTMLElement): Promise<void> {
  if (draft.running) return;
  draft.running = true;
  draft.error = undefined;
  mount(results, el('p', { class: 'status' }, t('erreur.running', ctx.lang)));
  try {
    draft.analysis = await analyzePastedLog(draft.text, ctx.workspace.store, ctx.workspace.now);
  } catch (error) {
    draft.error = error instanceof Error ? error.message : String(error);
    draft.analysis = undefined;
  } finally {
    draft.running = false;
    mount(results, ...resultsOf(draft.analysis, ctx.lang));
  }
}

/** Les huit boutons d'exemples : un clic remplace le texte collé. */
function sampleButtons(textarea: HTMLTextAreaElement, lang: Lang): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'section-note' }, t('erreur.samples', lang)),
    ...SAMPLES.map((sample) =>
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            draft.text = sample.text;
            textarea.value = sample.text;
          },
        },
        t(`erreur.sample.${sample.id}`, lang),
      ),
    ),
  );
}

export const panel: Panel = {
  id: 'erreur',
  title: (lang) => t('panel.erreur.title', lang),
  summary: (lang) => t('panel.erreur.summary', lang),
  render(host, ctx) {
    const { lang } = ctx;
    const textarea = el(
      'textarea',
      {
        id: 'erreur-input',
        class: 'mono',
        rows: 14,
        style: 'width: 100%; box-sizing: border-box;',
        spellcheck: false,
        placeholder: t('erreur.input.placeholder', lang),
        'aria-label': t('erreur.input.label', lang),
        oninput: (event: Event) => {
          draft.text = (event.target as HTMLTextAreaElement).value;
        },
      },
      draft.text,
    );
    const results = el('div', {}, ...resultsOf(draft.analysis, lang));
    mount(
      host,
      el('p', { class: 'section-note' }, t('erreur.note', lang)),
      el(
        'div',
        { class: 'block' },
        el('label', { for: 'erreur-input' }, t('erreur.input.label', lang)),
        textarea,
        el(
          'p',
          {},
          el(
            'button',
            { class: 'primary', type: 'button', onclick: () => void runAnalysis(ctx, results) },
            t('erreur.run', lang),
          ),
        ),
        sampleButtons(textarea, lang),
      ),
      el('div', { class: 'block' }, results),
    );
  },
};
