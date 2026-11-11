// Spécifications de groupes du corpus étiqueté (100 échecs, § 18).
//
// Chaque groupe est une signature attendue ; ses membres ne diffèrent que par
// un détail volatil (horodatage, numéro de ligne, UUID, port) : la
// normalisation du § 9.2 doit les ramener à une seule signature.
//
// `pairs` liste les couples de membres qui ne doivent différer que par ce
// détail ; le contrôle du corpus vérifie cette propriété indépendamment.
// `branches` répartit les membres d'un groupe sur plusieurs branches : les
// groupes instables en ont besoin pour atteindre le verdict du § 10.1.
//
// Les groupes sont répartis en trois familles (Python, JVM, Node/Go et divers)
// pour rester sous la barre des 500 lignes par fichier ; ce module les réunit
// dans l'ordre où le corpus les présente.

import { GROUPS as PYTHON } from './corpus-groups-python.mjs';
import { GROUPS as JVM } from './corpus-groups-jvm.mjs';
import { GROUPS as NODE_GO } from './corpus-groups-node-go.mjs';

export const GROUPS = [...PYTHON, ...JVM, ...NODE_GO];
