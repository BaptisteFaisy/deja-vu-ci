/**
 * Les textes du panneau « Entrée universelle » — anglais et français (§ 18).
 *
 * Ils vivent dans leur propre module : le panneau reste lisible, et les clés
 * du site ne sont jamais mélangées aux clés des autres panneaux.
 */

/** Les libellés du panneau : clé → [anglais, français]. */
export const TEXTES: Record<string, [string, string]> = {
  'panel.universel.title': ['Universal entry', 'Entrée universelle'],
  'panel.universel.summary': [
    'Any CI feeding the same memory: build the payload, copy the one-liner.',
    'N’importe quelle CI alimente la même mémoire : construisez la charge, copiez la ligne de commande.',
  ],
  'universel.intro': [
    'Build the payload, let the product judge it, then leave with the exact command for your CI.',
    'Construisez la charge, laissez le produit la juger, puis repartez avec la commande exacte pour votre CI.',
  ],
  'universel.noNetwork': [
    'Nothing leaves this page: the panel shows the commands, it never runs them.',
    'Rien ne quitte cette page : le panneau montre les commandes, il ne les exécute jamais.',
  ],
  'universel.form.title': ['The payload', 'La charge utile'],
  'universel.form.note': [
    'The fields of the universal contract, judged by the real validator of `packages/core`.',
    'Les champs du contrat universel, jugés par le vrai validateur de `packages/core`.',
  ],
  'universel.field.projectKey': ['Project key', 'Clé de projet'],
  'universel.field.projectKey.help': [
    'Never displayed: it is replaced by <PROJECT_KEY> everywhere below.',
    'Jamais affichée : elle est remplacée par <PROJECT_KEY> partout ci-dessous.',
  ],
  'universel.field.repository': ['Repository', 'Dépôt'],
  'universel.field.branch': ['Branch', 'Branche'],
  'universel.field.commit': ['Commit', 'Commit'],
  'universel.field.step': ['Step', 'Étape'],
  'universel.field.duration': ['Duration (s)', 'Durée (s)'],
  'universel.field.outcome': ['Outcome', 'Résultat'],
  'universel.field.log': ['Journal', 'Journal'],
  'universel.outcome.failure': ['failure', 'failure'],
  'universel.outcome.success': ['success', 'success'],
  'universel.examples': ['Examples per ecosystem', 'Exemples par écosystème'],
  'universel.example.github': ['GitHub Actions', 'GitHub Actions'],
  'universel.example.gitlab': ['GitLab CI', 'GitLab CI'],
  'universel.example.jenkins': ['Jenkins', 'Jenkins'],
  'universel.example.autre': ['Any other CI', 'N’importe quelle autre CI'],
  'universel.example.use': ['Use this example', 'Utiliser cet exemple'],
  'universel.validate': ['Validate the payload', 'Valider la charge'],
  'universel.reset': ['Reset', 'Réinitialiser'],
  'universel.noResult': [
    'Validate the payload to see what the product would do with it.',
    'Validez la charge pour voir ce que le produit en ferait.',
  ],
  'universel.accepted': ['Accepted by the real validator', 'Acceptée par le vrai validateur'],
  'universel.accepted.note': [
    'The payload is normalized: this is what the app would send.',
    'La charge est normalisée : voici ce que l’app enverrait.',
  ],
  'universel.refused': ['Refused by the real validator', 'Refusée par le vrai validateur'],
  'universel.refused.note': [
    'The validator names the faulty field — the app answers exactly like this.',
    'Le validateur nomme le champ fautif — l’app répond exactement ainsi.',
  ],
  'universel.normalized': ['Normalized payload', 'Charge normalisée'],
  'universel.masked': ['Masked payload (what leaves the machine)', 'Charge masquée (ce qui quitte la machine)'],
  'universel.masked.none': ['No secret found in this journal.', 'Aucun secret trouvé dans ce journal.'],
  'universel.masked.some': ['{count} secret(s) masked — {kinds}.', '{count} secret(s) masqués — {kinds}.'],
  'universel.masked.truncated': ['The journal was truncated to 50 KiB.', 'Le journal a été tronqué à 50 KiB.'],
  'universel.key.note': [
    'The project key is never displayed: it is replaced by <PROJECT_KEY>.',
    'La clé de projet n’est jamais affichée : elle est remplacée par <PROJECT_KEY>.',
  ],
  'universel.extras.note': [
    'Duration and outcome are tolerated by the contract, but they are not part of the normalized payload.',
    'La durée et le résultat sont tolérés par le contrat, mais ne font pas partie de la charge normalisée.',
  ],
  'universel.skip.note': [
    'The integrations only report failures: with this outcome, nothing would be sent.',
    'Les intégrations n’envoient que les échecs : avec ce résultat, rien ne partirait.',
  ],
  'universel.snippets.title': ['The command for your CI', 'La commande pour votre CI'],
  'universel.snippets.note': [
    'Six integrations, one payload: every command below sends exactly the charge shown above.',
    'Six intégrations, une seule charge : chaque commande ci-dessous envoie exactement la charge montrée plus haut.',
  ],
  'universel.snippet.curl': ['curl — raw HTTP', 'curl — HTTP brut'],
  'universel.snippet.github': ['GitHub Action', 'Action GitHub'],
  'universel.snippet.gitlab': ['GitLab CI', 'GitLab CI'],
  'universel.snippet.jenkins': ['Jenkins', 'Jenkins'],
  'universel.snippet.cli': ['npm CLI', 'CLI npm'],
  'universel.snippet.python': ['Python SDK', 'SDK Python'],
  'universel.copy': ['Copy', 'Copier'],
  'universel.copied': ['Copied', 'Copié'],
  'universel.copy.failed': ['Copy refused by the browser', 'Copie refusée par le navigateur'],
  'universel.adapter.title': ['The adapter: a raw GitHub Actions log', 'L’adaptateur : un journal brut GitHub Actions'],
  'universel.adapter.note': [
    'The real adapter of `integrations/adapters/` reads the raw log: step, duration, exit code, failed tests.',
    'Le vrai adaptateur de `integrations/adapters/` lit le journal brut : étape, durée, code de sortie, tests en échec.',
  ],
  'universel.adapter.report': ['What the adapter extracts', 'Ce que l’adaptateur en tire'],
  'universel.adapter.payload': ['The payload it produces', 'La charge qu’il produit'],
  'universel.col.step': ['Step', 'Étape'],
  'universel.col.value': ['Value', 'Valeur'],
  'universel.col.field': ['Field', 'Champ'],
  'universel.chars': ['{n} characters', '{n} caractères'],
  'universel.col.duration': ['Duration', 'Durée'],
  'universel.col.exit': ['Exit code', 'Code de sortie'],
  'universel.col.tests': ['Failed tests', 'Tests en échec'],
  'universel.docs.title': ['The contract', 'Le contrat'],
  'universel.docs.note': [
    'The machine-readable contract and its human companion, in the repository.',
    'Le contrat lisible par la machine et son compagnon humain, dans le dépôt.',
  ],
  'universel.docs.openapi': ['openapi.yaml — the machine-readable contract', 'openapi.yaml — le contrat lisible par la machine'],
  'universel.docs.guide': ['API-UNIVERSELLE.md — the human guide', 'API-UNIVERSELLE.md — le guide humain'],
};
