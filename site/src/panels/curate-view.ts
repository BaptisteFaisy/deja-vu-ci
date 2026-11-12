/**
 * Panneau « Curation » — la mise en forme (DOM) des gestes de curation.
 *
 * Ce module ne fait que **montrer** ce que le moteur a répondu : aucune
 * décision, aucun calcul. Les textes viennent de la table du panneau
 * (`registerStrings`, dans `curate.ts`), les libellés du domaine (statut,
 * catégorie, date, confiance) de `@dejavu/present`, et les résultats des
 * opérations de `curate-ops.ts`.
 *
 * Aucune chaîne HTML n'est injectée : tout passe par `textContent`.
 */

import {
  QUARANTINE_DUE_DAYS,
  WORTH_IT,
  signatureShort,
  type Signature,
} from '@dejavu/core';
import { formatConfidence, formatDate, statusLabel, statusTone } from '@dejavu/present';
import { badge, el, table, type Child } from '../render/dom';
import { fill, t, type Lang } from '../lib/i18n';
import * as ops from './curate-ops';

/** Ce que le panneau retient entre deux rendus. */
export interface CurateState {
  signatures: Signature[];
  snapshot?: ops.MemorySnapshot;
  keepId: string;
  dropId: string;
  splitId: string;
  criterion: ops.SplitCriterionKey;
  ruleA: string;
  ruleB: string;
  quarantineId: string;
  busy: boolean;
  error?: string;
  mergePreview?: ops.MergePreviewData;
  mergeApplied?: ops.MergeApplied;
  splitPreview?: ops.SplitResult;
  splitApplied?: ops.SplitApplied;
  rule?: ops.RuleView;
  quarantine?: ops.QuarantineView;
}

/** Les gestes que le visiteur peut faire. */
export interface CurateHandlers {
  onKeep(id: string): void;
  onDrop(id: string): void;
  onSplit(id: string): void;
  onCriterion(key: ops.SplitCriterionKey): void;
  onRuleA(id: string): void;
  onRuleB(id: string): void;
  onQuarantine(id: string): void;
  previewMerge(): void;
  applyMerge(): void;
  previewSplit(): void;
  applySplit(): void;
  compareRules(): void;
  proposeQuarantine(): void;
  reset(): void;
}

/** Le libellé d'une signature dans une liste déroulante. */
function optionLabel(signature: Signature, lang: Lang): string {
  const head = `${signatureShort(signature.id)} · ${statusLabel(signature.status, lang)} · ${signature.occurrences}×`;
  const tail = signature.testName ?? ops.shortTemplate(signature.template, 44);
  return `${head} · ${tail}`;
}

/** Une liste déroulante de signatures. */
function signatureSelect(
  state: CurateState,
  lang: Lang,
  value: string,
  label: string,
  onChange: (id: string) => void,
): HTMLElement {
  const select = el(
    'select',
    {
      onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
    },
    ...state.signatures.map((signature) =>
      el('option', { value: signature.id, selected: signature.id === value }, optionLabel(signature, lang)),
    ),
  );
  return el('p', { class: 'section-note' }, label, ' ', select);
}

/** Une liste de faits : « libellé : valeur », comme le reste du site. */
function facts(items: string[]): HTMLElement {
  return el('ul', { class: 'facts' }, ...items.map((item) => el('li', {}, item)));
}

/** Un bloc de code : le snippet d'isolation ou la description du ticket. */
function code(text: string): HTMLElement {
  return el('pre', { class: 'mono' }, text);
}

/** Les compteurs « avant → après » d'une opération appliquée. */
function beforeAfter(before: ops.MemorySnapshot, after: ops.MemorySnapshot, lang: Lang): HTMLElement {
  return el(
    'p',
    { class: 'facts' },
    fill(t('curate.beforeAfter', lang), {
      signaturesBefore: before.signatures,
      signaturesAfter: after.signatures,
      occurrencesBefore: before.occurrences,
      occurrencesAfter: after.occurrences,
      ticketsBefore: before.tickets,
      ticketsAfter: after.tickets,
    }),
  );
}

/** La carte « la mémoire de cette page » : compteurs et réinitialisation. */
export function memoryCard(state: CurateState, lang: Lang, handlers: CurateHandlers): HTMLElement {
  const snapshot = state.snapshot;
  const counters = el(
    'ul',
    { class: 'counters' },
    el('li', {}, el('span', { class: 'value' }, String(snapshot?.signatures ?? '—')), el('span', { class: 'label' }, t('counter.signatures', lang))),
    el('li', {}, el('span', { class: 'value' }, String(snapshot?.occurrences ?? '—')), el('span', { class: 'label' }, t('col.occurrences', lang))),
    el('li', {}, el('span', { class: 'value' }, String(snapshot?.tickets ?? '—')), el('span', { class: 'label' }, t('curate.snapshot.tickets', lang))),
  );
  return el(
    'div',
    { class: 'panel block' },
    el('h2', {}, t('curate.memory.title', lang)),
    el('p', { class: 'section-note' }, t('curate.memory.note', lang)),
    counters,
    el('p', {}, el('button', { type: 'button', disabled: state.busy, onclick: () => handlers.reset() }, t('curate.reset', lang))),
    el('p', { class: 'facts' }, t('curate.honesty', lang)),
  );
}

/** L'aperçu d'une fusion : statut, occurrences, ticket, règle proposée. */
function mergePreviewFacts(state: CurateState, lang: Lang): HTMLElement {
  const preview = state.mergePreview;
  if (!preview) return el('p', { class: 'empty' }, t('curate.merge.none', lang));
  const kept = state.signatures.find((s) => s.id === state.keepId);
  const dropped = state.signatures.find((s) => s.id === state.dropId);
  const items = [
    `${t('col.status', lang)}: ${badge(statusLabel(kept?.status ?? 'new', lang), statusTone(kept?.status ?? 'new'))} → ${badge(statusLabel(preview.merged.status, lang), statusTone(preview.merged.status))}`,
    `${t('col.occurrences', lang)}: ${(kept?.occurrences ?? 0) + (dropped?.occurrences ?? 0)} → ${preview.merged.occurrences}`,
    `${t('curate.merge.moved', lang)}: ${preview.movedOccurrences}`,
    `${t('col.ticket', lang)}: ${preview.merged.issueKey ?? '—'}`,
    `${t('col.firstSeen', lang)}: ${formatDate(preview.merged.firstSeen, lang)} — ${t('col.lastSeen', lang)}: ${formatDate(preview.merged.lastSeen, lang)}`,
  ];
  const rule = preview.rule;
  if (rule) {
    items.push(
      `${t('curate.rule.token', lang)}: ${rule.token}`,
      `${t('curate.rule.pattern', lang)}: ${rule.pattern} → ${rule.replacement}`,
      `${t('curate.rule.covered', lang)}: ${rule.alreadyCovered ? t('curate.rule.coveredYes', lang) : t('curate.rule.toAdd', lang)}`,
    );
  }
  return facts(items);
}

/** La carte « fusionner deux signatures ». */
export function mergeCard(state: CurateState, lang: Lang, handlers: CurateHandlers): HTMLElement {
  const order = ops.statusPrecedence().map((status) => statusLabel(status, lang)).join(' > ');
  const applied = state.mergeApplied;
  const body: Child[] = [];
  if (applied) {
    body.push(el('p', { class: 'facts' }, t('curate.applied', lang)), beforeAfter(applied.before, applied.after, lang));
  } else {
    body.push(mergePreviewFacts(state, lang));
  }
  return el(
    'div',
    { class: 'panel block' },
    el('h2', {}, t('curate.merge.title', lang)),
    el('p', { class: 'section-note' }, fill(t('curate.merge.note', lang), { order })),
    signatureSelect(state, lang, state.keepId, t('curate.merge.keep', lang), handlers.onKeep),
    signatureSelect(state, lang, state.dropId, t('curate.merge.drop', lang), handlers.onDrop),
    el(
      'p',
      {},
      el('button', { type: 'button', disabled: state.busy, onclick: () => handlers.previewMerge() }, t('curate.merge.preview', lang)),
      ' ',
      el('button', { type: 'button', disabled: state.busy || !state.mergePreview, onclick: () => handlers.applyMerge() }, t('curate.merge.apply', lang)),
    ),
    ...body,
  );
}

/** Le tableau des groupes d'une scission. */
function splitTable(state: CurateState, lang: Lang): HTMLElement {
  const preview = state.splitPreview;
  const headers = [
    t('curate.split.group', lang), t('col.occurrences', lang), t('col.status', lang),
    t('curate.split.origin', lang), t('col.ticket', lang),
  ];
  if (!preview) return el('p', { class: 'empty' }, t('curate.split.none', lang));
  if (preview.groups.length < 2) return el('p', { class: 'empty' }, t('curate.split.one', lang));
  const rows: Child[][] = preview.groups.map((group, index) => [
    el('span', { class: 'mono' }, ops.shortTemplate(group.signature.template, 40)),
    String(group.occurrences.length),
    badge(statusLabel(group.signature.status, lang), statusTone(group.signature.status)),
    index === 0 ? t('curate.split.kept', lang) : t('curate.split.derived', lang),
    el('span', { class: 'mono' }, group.signature.issueKey ?? '—'),
  ]);
  return table(headers, rows, t('curate.split.none', lang));
}

/** La carte « scinder une signature ». */
export function splitCard(state: CurateState, lang: Lang, handlers: CurateHandlers): HTMLElement {
  const criterionSelect = el(
    'select',
    { onchange: (event: Event) => handlers.onCriterion((event.target as HTMLSelectElement).value as ops.SplitCriterionKey) },
    ...ops.SPLIT_KEYS.map((key) =>
      el('option', { value: key, selected: key === state.criterion }, t(`curate.criterion.${key}`, lang)),
    ),
  );
  const applied = state.splitApplied;
  const body: Child[] = [];
  if (applied) {
    body.push(el('p', { class: 'facts' }, t('curate.applied', lang)), beforeAfter(applied.before, applied.after, lang));
  }
  body.push(splitTable(state, lang));
  return el(
    'div',
    { class: 'panel block' },
    el('h2', {}, t('curate.split.title', lang)),
    el('p', { class: 'section-note' }, t('curate.split.note', lang)),
    signatureSelect(state, lang, state.splitId, t('curate.split.signature', lang), handlers.onSplit),
    el('p', { class: 'section-note' }, t('curate.split.criterion', lang), ' ', criterionSelect),
    el(
      'p',
      {},
      el('button', { type: 'button', disabled: state.busy, onclick: () => handlers.previewSplit() }, t('curate.split.preview', lang)),
      ' ',
      el('button', { type: 'button', disabled: state.busy || !state.splitPreview, onclick: () => handlers.applySplit() }, t('curate.split.apply', lang)),
    ),
    ...body,
  );
}

/** La carte « règle de normalisation ». */
export function ruleCard(state: CurateState, lang: Lang, handlers: CurateHandlers): HTMLElement {
  const rule = state.rule?.rule;
  const body: Child[] = [];
  if (rule) {
    body.push(
      facts([
        `${t('curate.rule.token', lang)}: ${rule.token}`,
        `${t('curate.rule.pattern', lang)}: ${rule.pattern}`,
        `${t('curate.rule.replacement', lang)}: ${rule.replacement}`,
        `${t('col.confidence', lang)}: ${formatConfidence(rule.confidence)}`,
      ]),
      el(
        'p',
        {},
        rule.alreadyCovered
          ? badge(t('curate.rule.coveredYes', lang), 'green')
          : badge(t('curate.rule.toAdd', lang), 'yellow'),
      ),
    );
  } else if (state.rule) {
    body.push(el('p', { class: 'empty' }, t('curate.rule.none', lang)));
  }
  return el(
    'div',
    { class: 'panel block' },
    el('h2', {}, t('curate.rule.title', lang)),
    el('p', { class: 'section-note' }, t('curate.rule.note', lang)),
    signatureSelect(state, lang, state.ruleA, t('curate.rule.a', lang), handlers.onRuleA),
    signatureSelect(state, lang, state.ruleB, t('curate.rule.b', lang), handlers.onRuleB),
    el('p', {}, el('button', { type: 'button', disabled: state.busy, onclick: () => handlers.compareRules() }, t('curate.rule.compare', lang))),
    ...body,
  );
}

/** Les faits du verdict d'instabilité (les raisons du moteur, textuelles). */
function verdictFacts(view: ops.QuarantineView, lang: Lang): HTMLElement {
  const verdict = view.verdict;
  return facts([
    `${t('col.occurrences', lang)}: ${verdict.occurrences}`,
    `${t('curate.quarantine.branches', lang)}: ${verdict.branches}`,
    `${t('curate.quarantine.flakyIndex', lang)}: ${verdict.flakyIndex.toFixed(2)}`,
    ...verdict.reasons,
  ]);
}

/** La proposition de quarantaine : snippet, ticket et verdict « en vaut la peine ». */
function proposalFacts(view: ops.QuarantineView, lang: Lang): HTMLElement {
  const proposal = view.proposal;
  if (!proposal) return el('p', { class: 'empty' }, t('curate.quarantine.notFlaky', lang));
  const ticket = proposal.ticket;
  const items = [
    `${t('curate.quarantine.file', lang)}: ${proposal.patch.file}`,
    `${t('curate.quarantine.cost', lang)}: ${proposal.cost.occurrences} ${t('col.occurrences', lang)} · ${proposal.cost.branches} ${t('curate.quarantine.branches', lang)} · ${Math.round(proposal.cost.ciMinutesLost)} ${t('cost.minutesLost', lang)} · ${t('curate.quarantine.flakyIndex', lang)} ${proposal.cost.flakyIndex.toFixed(2)}`,
    `${t('curate.quarantine.assignee', lang)}: ${ticket.assignee ?? '—'}`,
    `${t('curate.quarantine.due', lang)}: ${ticket.dueInDays} ${t('curate.quarantine.days', lang)}`,
  ];
  return el(
    'div',
    {},
    el('h3', {}, t('curate.quarantine.snippet', lang)),
    code(proposal.patch.snippet),
    el('p', { class: 'facts' }, proposal.patch.instruction),
    el('h3', {}, t('curate.quarantine.ticket', lang)),
    el('p', {}, el('strong', {}, ticket.summary)),
    el('p', { class: 'facts' }, ...ticket.labels.map((label) => badge(label, 'purple'))),
    code(ticket.description),
    facts(items),
    el(
      'p',
      {},
      proposal.worthIt ? badge(t('curate.quarantine.worth', lang), 'green') : badge(t('curate.quarantine.notWorth', lang), 'grey'),
    ),
    el(
      'p',
      { class: 'facts' },
      fill(t('curate.quarantine.thresholds', lang), {
        minutes: WORTH_IT.ciMinutesLost,
        index: WORTH_IT.flakyIndex,
        occurrences: WORTH_IT.occurrences,
        days: QUARANTINE_DUE_DAYS,
      }),
    ),
  );
}

/** La carte « mettre un test instable en quarantaine ». */
export function quarantineCard(state: CurateState, lang: Lang, handlers: CurateHandlers): HTMLElement {
  const body: Child[] = [];
  if (state.quarantine) {
    body.push(verdictFacts(state.quarantine, lang), proposalFacts(state.quarantine, lang));
  }
  return el(
    'div',
    { class: 'panel block' },
    el('h2', {}, t('curate.quarantine.title', lang)),
    el('p', { class: 'section-note' }, t('curate.quarantine.note', lang)),
    signatureSelect(state, lang, state.quarantineId, t('curate.quarantine.signature', lang), handlers.onQuarantine),
    el('p', {}, el('button', { type: 'button', disabled: state.busy, onclick: () => handlers.proposeQuarantine() }, t('curate.quarantine.propose', lang))),
    ...body,
  );
}
