/**
 * Le contrat d'un panneau — la brique d'affichage du site.
 *
 * Un panneau est un module qui exporte `panel` : un identifiant, un titre et
 * un résumé dans les deux langues, et une fonction `render` qui remplit un
 * hôte. `render` est rappelé à chaque changement d'état : elle doit donc être
 * **idempotente** (elle reconstruit son contenu, jamais de cumul).
 *
 * Chaque panneau vit dans **son** fichier et enregistre **ses** chaînes de
 * traduction (`registerStrings`) : deux panneaux ne se marchent jamais dessus,
 * et le registre (`registry.ts`) n'a pas besoin d'être modifié pour qu'un
 * panneau existe.
 */

import type { Lang } from '../lib/i18n';
import type { Workspace } from '../state/workspace';

/** Ce qu'un panneau reçoit pour se rendre. */
export interface PanelContext {
  /** La langue courante. */
  lang: Lang;
  /** La mémoire partagée : moteurs, vue dérivée, horloge, abonnements. */
  workspace: Workspace;
}

/** Un panneau du site. */
export interface Panel {
  /** Identifiant stable : sert d'ancre et de paramètre `?panel=`. */
  id: string;
  /** Titre de l'onglet. */
  title(lang: Lang): string;
  /** Une phrase : ce que le panneau montre, et avec quel code réel. */
  summary(lang: Lang): string;
  /** Rend le panneau dans l'hôte (appelé à chaque changement d'état). */
  render(host: HTMLElement, ctx: PanelContext): void;
}
