/**
 * Le registre des panneaux — l'ordre d'affichage.
 *
 * Ce fichier est la **seule** liste à maintenir : chaque panneau vit dans son
 * propre module et enregistre ses propres chaînes, donc ajouter un panneau ne
 * demande qu'une ligne ici. Rien d'autre n'est partagé entre panneaux : ils
 * peuvent être écrits en parallèle sans se marcher dessus.
 */

import type { Panel } from './types';
import { panel as replay } from './replay';
import { panel as erreur } from './erreur';
import { panel as pr } from './pr';
import { panel as jira } from './jira';
import { panel as rovo } from './rovo';
import { panel as curate } from './curate';
import { panel as incident } from './incident';
import { panel as cout } from './cout';
import { panel as universel } from './universel';
import { panel as securite } from './securite';
import { panel as justesse } from './justesse';
import { panel as preuves } from './preuves';

/** Tous les panneaux, dans l'ordre où les onglets les affichent. */
export const PANELS: Panel[] = [
  replay,
  erreur, pr, jira, rovo, curate, incident, cout, universel, securite, justesse, preuves,
];

/** Le panneau d'un identifiant, s'il existe. */
export function panelById(id: string): Panel | undefined {
  return PANELS.find((candidate) => candidate.id === id);
}
