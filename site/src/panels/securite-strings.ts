/**
 * Les textes du panneau « Sécurité » — anglais et français, enregistrés au
 * chargement du module (chaque panneau possède ses clés, `lib/i18n.ts`).
 *
 * Les **raisons de refus** et les libellés de politiques ne sont pas ici : ce
 * sont les chaînes réelles du produit (`packages/bridge`, `packages/core`),
 * affichées telles quelles — la langue de son code.
 */

import { registerStrings } from '../lib/i18n';

registerStrings({
  'panel.securite.title': ['Security', 'Sécurité'],
  'panel.securite.summary': [
    'Masking, the signed bridge, minimization and the SBOM — computed live by the product’s own code, in your browser.',
    'Masquage, pont signé, minimisation et SBOM — calculés en direct par le vrai code du produit, dans votre navigateur.',
  ],

  'securite.masking.title': ['Masking: the patterns at the door', 'Masquage : les motifs à la porte'],
  'securite.masking.note': [
    'The real `maskSecrets` of `packages/core` (21 patterns: tokens, keys, connection-string passwords, ' +
      'emails, cards, IBAN, phones…). Edit the text — every example below is fictional and built at run ' +
      'time — then add your own pattern: it is appended to the defaults, it never removes one.',
    'Le vrai `maskSecrets` de `packages/core` (21 motifs : jetons, clés, mots de passe d’URL de connexion, ' +
      'adresses, cartes, IBAN, téléphones…). Modifiez le texte — chaque exemple est fictif et construit à ' +
      'l’exécution — puis ajoutez votre propre motif : il s’ajoute aux motifs par défaut, sans jamais en retirer.',
  ],
  'securite.masking.input': ['Text to mask', 'Texte à masquer'],
  'securite.masking.extraSource': ['Extra pattern (regular expression)', 'Motif supplémentaire (expression régulière)'],
  'securite.masking.extraKind': ['Label', 'Libellé'],
  'securite.masking.run': ['Mask', 'Masquer'],
  'securite.masking.reset': ['Reset the example', 'Réinitialiser l’exemple'],
  'securite.masking.masked': ['Secrets masked', 'Secrets masqués'],
  'securite.masking.kinds': ['Patterns that matched', 'Motifs qui ont touché'],
  'securite.masking.base': ['With the default patterns', 'Avec les motifs par défaut'],
  'securite.masking.withExtra': ['With your extra pattern', 'Avec votre motif supplémentaire'],
  'securite.masking.defaultsKept': ['Default patterns still applied', 'Motifs par défaut toujours appliqués'],
  'securite.masking.defaultsLost': ['A default pattern stopped matching', 'Un motif par défaut ne touche plus'],
  'securite.masking.badRegex': ['Invalid regular expression', 'Expression régulière invalide'],
  'securite.masking.maskedText': ['Masked text', 'Texte masqué'],
  'securite.masking.raw': ['Raw result (JSON)', 'Résultat brut (JSON)'],
  'securite.masking.noExtra': ['No extra pattern: only the defaults run.', 'Pas de motif supplémentaire : seuls les motifs par défaut tournent.'],

  'securite.bridge.title': ['The signed bridge: what is accepted, what is refused',
    'Le pont signé : ce qui est accepté, ce qui est refusé'],
  'securite.bridge.note': [
    'The real `packages/bridge`: HMAC-SHA256 over “timestamp.nonce.body”, computed in your browser by the ' +
      'verified shim. The envelope below is signed with a fictional shared secret and the workshop’s fixed ' +
      'clock; the reasons shown are the product’s own strings.',
    'Le vrai `packages/bridge` : HMAC-SHA256 de « horodatage.nonce.corps », calculé dans votre navigateur ' +
      'par le substitut vérifié. L’enveloppe ci-dessous est signée avec un secret partagé fictif et ' +
      'l’horloge fixe de l’atelier ; les raisons affichées sont les chaînes du produit lui-même.',
  ],
  'securite.bridge.secret': ['Shared secret (fictional)', 'Secret partagé (fictif)'],
  'securite.bridge.clock': ['Demonstration clock', 'Horloge de démonstration'],
  'securite.bridge.headers': ['Headers sent (BRIDGE_HEADERS)', 'En-têtes envoyés (BRIDGE_HEADERS)'],
  'securite.bridge.header': ['Header', 'En-tête'],
  'securite.bridge.value': ['Value', 'Valeur'],
  'securite.bridge.body': ['Body (signed envelope)', 'Corps (enveloppe signée)'],
  'securite.bridge.verify': ['Verification (verifyRequest)', 'Vérification (verifyRequest)'],
  'securite.bridge.accepted': ['Accepted', 'Accepté'],
  'securite.bridge.refused': ['Refused', 'Refusé'],
  'securite.bridge.payload': ['Payload returned to the Brain', 'Charge utile rendue au Cerveau'],
  'securite.bridge.refusals': ['The real refusals, one by one', 'Les refus réels, un par un'],
  'securite.bridge.scenario': ['Scenario', 'Scénario'],
  'securite.bridge.reason': ['Reason returned by the product', 'Raison renvoyée par le produit'],
  'securite.bridge.try': ['Try', 'Essayer'],
  'securite.bridge.rotation': ['Key rotation without downtime', 'Rotation de clé sans interruption'],
  'securite.bridge.rotation.note': [
    'The real `rotateSecret`: the new key signs, the previous one still verifies during the overlap window.',
    'Le vrai `rotateSecret` : la nouvelle clé signe, l’ancienne vérifie encore pendant la période de chevauchement.',
  ],
  'securite.bridge.rotation.run': ['Rotate the key', 'Faire tourner la clé'],
  'securite.bridge.rotation.case': ['Case', 'Cas'],
  'securite.bridge.rotation.old': ['Message signed before the rotation, verified with the rotated set',
    'Message signé avant la rotation, vérifié avec l’ensemble tourné'],
  'securite.bridge.rotation.new': ['Message signed after the rotation (new active key)',
    'Message signé après la rotation (nouvelle clé active)'],
  'securite.bridge.rotation.after': ['Old message, new key alone (overlap over)',
    'Ancien message, nouvelle clé seule (chevauchement terminé)'],
  'securite.bridge.rotation.set': ['Rotated key set (new key first)', 'Ensemble de clés tourné (nouvelle clé en premier)'],

  'securite.scenario.tampered': ['Altered body (outcome flipped)', 'Corps altéré (outcome retourné)'],
  'securite.scenario.stale': ['Timestamp outside the window', 'Horodatage hors fenêtre'],
  'securite.scenario.replay': ['Nonce already consumed (replay)', 'Nonce déjà consommé (rejeu)'],
  'securite.scenario.wrongSecret': ['Wrong shared secret', 'Mauvais secret partagé'],
  'securite.scenario.huge': ['Body larger than the limit', 'Corps plus gros que la limite'],
  'securite.scenario.missingHeader': ['Missing bridge header', 'En-tête du pont manquant'],

  'securite.minimize.title': ['Minimization: three retention policies', 'Minimisation : trois politiques de conservation'],
  'securite.minimize.note': [
    'The same raw excerpt — the real log of the first failure of the sample set — reduced by the engine ' +
      '(`packages/core/src/minimize.ts`) and by the Brain’s copy (`apps/brain/src/pure/excerptPolicy.ts`): ' +
      'both must agree, policy by policy.',
    'Le même extrait brut — le journal réel du premier échec du jeu d’exemple — réduit par le moteur ' +
      '(`packages/core/src/minimize.ts`) et par la copie du Cerveau (`apps/brain/src/pure/excerptPolicy.ts`) : ' +
      'les deux doivent concorder, politique par politique.',
  ],
  'securite.minimize.source': ['Source excerpt (raw, real)', 'Extrait source (brut, réel)'],
  'securite.minimize.policy': ['Policy', 'Politique'],
  'securite.minimize.fingerprint': ['Fingerprint', 'Empreinte'],
  'securite.minimize.stored': ['What is stored', 'Ce qui est stocké'],
  'securite.minimize.bytes': ['Bytes', 'Octets'],
  'securite.minimize.nothing': ['nothing — fingerprint only', 'rien — l’empreinte seule'],
  'securite.minimize.truncated': ['truncated', 'tronqué'],
  'securite.minimize.kept': ['kept in full', 'conservé en entier'],
  'securite.minimize.agree': ['Engine ↔ Brain', 'Moteur ↔ Cerveau'],

  'securite.sbom.title': ['Inventory: the real SBOM of the repository', 'Inventaire : le vrai SBOM du dépôt'],
  'securite.sbom.note': [
    'Every runtime dependency of the two Forge apps, read from `docs/SBOM.json` (CycloneDX 1.5, generated ' +
      'by `tools/sbom.mjs`). First-party packages carry the repository’s licence; a licence the SBOM does ' +
      'not declare is shown as absent — never invented (see `docs/THIRD-PARTY.md`).',
    'Toutes les dépendances d’exécution des deux apps Forge, lues depuis `docs/SBOM.json` (CycloneDX 1.5, ' +
      'généré par `tools/sbom.mjs`). Les paquets internes portent la licence du dépôt ; une licence que le ' +
      'SBOM ne déclare pas est affichée absente — jamais inventée (voir `docs/THIRD-PARTY.md`).',
  ],
  'securite.sbom.component': ['Component', 'Composant'],
  'securite.sbom.version': ['Version', 'Version'],
  'securite.sbom.license': ['Licence', 'Licence'],
  'securite.sbom.origin': ['Origin', 'Origine'],
  'securite.sbom.firstParty': ['first party', 'interne'],
  'securite.sbom.thirdParty': ['third party', 'tiers'],
  'securite.sbom.undeclared': ['not declared', 'non déclarée'],
  'securite.sbom.docs': ['Read further', 'Aller plus loin'],
  'securite.sbom.threat': ['Threat model', 'Modèle de menace'],
  'securite.sbom.policy': ['Security policy', 'Politique de sécurité'],
  'securite.sbom.thirdparty': ['Third-party licences', 'Licences tierces'],
  'securite.sbom.file': ['SBOM (CycloneDX)', 'SBOM (CycloneDX)'],
});
