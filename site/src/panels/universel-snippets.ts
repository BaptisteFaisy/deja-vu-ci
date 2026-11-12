/**
 * Les commandes affichées par le panneau « Entrée universelle ».
 *
 * Chaque commande reproduit **la syntaxe exacte** de l'intégration du dépôt
 * (`integrations/github-action/`, `integrations/gitlab/`,
 * `integrations/jenkins/`, `integrations/cli/`, `integrations/python/`) — un
 * extrait qui ne ressemble pas au vrai serait pire qu'absent.
 *
 * Toutes les commandes sont Derivées de la même charge utile (la charge
 * masquée, telle qu'elle partirait) : aucune valeur n'est recopiée à la main.
 */

import type { FormValues } from './universel-donnees';

/** Une commande à copier, avec sa clé de traduction. */
export interface Snippet {
  /** Identifiant technique de l'extrait. */
  id: string;
  /** Clé de traduction de son titre. */
  labelKey: string;
  /** Le texte à copier. */
  text: string;
}

/** La charge utile, en JSON compact — la même dans tous les extraits. */
function compact(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/** La commande `curl` : la charge utile est le corps de la requête. */
export function curlSnippet(payload: Record<string, unknown>): string {
  return [
    '# export DEJAVU_BRAIN_URL=… and DEJAVU_PROJECT_KEY=… before',
    "curl -s -m 15 -o /dev/null -w '%{http_code}' \\",
    '  -X POST "$DEJAVU_BRAIN_URL" \\',
    "  -H 'Content-Type: application/json' \\",
    "  --data-binary @- <<'DEJAVU_EOF'",
    JSON.stringify(payload, null, 2),
    'DEJAVU_EOF',
  ].join('\n');
}

/** L'étape GitHub Action, comme la doc de `integrations/github-action/`. */
export function githubActionSnippet(payload: Record<string, unknown>, values: FormValues): string {
  return [
    '      - name: Report red builds to Déjà-vu CI',
    '        if: failure()',
    '        uses: BaptisteFaisy/deja-vu-ci/integrations/github-action@main',
    '        with:',
    '          brain-url: ${{ secrets.DEJAVU_BRAIN_URL }}',
    '          secret-key: ${{ secrets.DEJAVU_PROJECT_KEY }}',
    `          repository: ${JSON.stringify(values.repository)}`,
    `          branch: ${JSON.stringify(values.branch)}`,
    `          commit: ${JSON.stringify(values.commit)}`,
    `          step: ${JSON.stringify(values.step)}`,
    `          outcome: ${JSON.stringify(values.outcome)}`,
    '          log-file: /tmp/test.log',
    '# Payload sent:',
    `# ${compact(payload)}`,
  ].join('\n');
}

/** Le bloc `.deja-vu-report` de `integrations/gitlab/gitlab-ci.yml`. */
export function gitlabSnippet(payload: Record<string, unknown>): string {
  return [
    '# .gitlab-ci.yml — the block, then the job that extends it',
    '.deja-vu-report:',
    '  artifacts:',
    '    when: on_failure',
    '    expire_in: 1 week',
    '    paths:',
    '      - build.log',
    '  after_script:',
    '    - |',
    '      if [ "$CI_JOB_STATUS" != "success" ]; then',
    '        URL="${DEJAVU_BRAIN_URL:-}"',
    '        KEY="${DEJAVU_PROJECT_KEY:-}"',
    '        LOG_FILE="$CI_PROJECT_DIR/build.log"',
    '        if [ -n "$URL" ] && [ -n "$KEY" ] && [ -f "$LOG_FILE" ]; then',
    '          LOG=$(tail -c 51200 "$LOG_FILE")',
    `          SIGNATURE=$(printf '%s' "$CI_PROJECT_PATH|$CI_COMMIT_REF_NAME|$CI_COMMIT_SHA|$CI_JOB_NAME|$LOG" | sha256sum | cut -d' ' -f1)`,
    '          esc() { printf \'%s\' "$1" | sed -e \'s/\\\\/\\\\\\\\/g\' -e \'s/"/\\\\"/g\'; }',
    '          BODY=$(printf \'{"projectKey":"%s","repository":"%s","branch":"%s","commit":"%s","step":"%s","log":"%s","idempotencyKey":"%s"}\' \\',
    '            "$(esc "$KEY")" "$(esc "$CI_PROJECT_PATH")" "$(esc "$CI_COMMIT_REF_NAME")" \\',
    '            "$(esc "$CI_COMMIT_SHA")" "$(esc "$CI_JOB_NAME")" "$(esc "$LOG")" "$SIGNATURE")',
    '          CODE=$(curl -s -m 20 -o /dev/null -w \'%{http_code}\' -X POST "$URL" \\',
    '            -H \'Content-Type: application/json\' --data-binary "$BODY" 2>/dev/null || true)',
    '          CODE="${CODE:-000}"',
    '          if [ "$CODE" = "202" ] || [ "$CODE" = "200" ]; then',
    '            echo "[deja-vu] reported (HTTP $CODE)"',
    '          else',
    '            echo "[deja-vu] Brain unreachable or refused (HTTP $CODE) — pipeline continues" >&2',
    '          fi',
    '        else',
    '          echo "[deja-vu] skipped: missing DEJAVU_BRAIN_URL, DEJAVU_PROJECT_KEY or build.log" >&2',
    '        fi',
    '      else',
    '        echo "[deja-vu] success — nothing to report"',
    '      fi',
    '',
    '# Then extend the job you want to watch:',
    '#   test:',
    '#     extends: .deja-vu-report',
    '#     script:',
    '#       - make test 2>&1 | tee build.log',
    '# Payload sent:',
    `# ${compact(payload)}`,
  ].join('\n');
}

/** Le helper Groovy de `integrations/jenkins/Jenkinsfile`. */
function jenkinsHelper(): string[] {
  return [
    '// Jenkinsfile — the helper, then the block that calls it',
    "def dejaVuReport(String logFile = 'build.log') {",
    "    def url = env.DEJAVU_BRAIN_URL ?: ''",
    "    def key = env.DEJAVU_PROJECT_KEY ?: ''",
    '    if (!url || !key) {',
    "        echo '[deja-vu] skipped: DEJAVU_BRAIN_URL or DEJAVU_PROJECT_KEY missing'",
    '        return',
    '    }',
    '    def f = new File("${env.WORKSPACE}/${logFile}")',
    '    if (!f.exists()) {',
    '        echo "[deja-vu] skipped: ${logFile} not found"',
    '        return',
    '    }',
    '    def log = f.text',
    '    if (log.length() > 51200) {',
    '        log = log.substring(log.length() - 51200)',
    '    }',
    '    def repo = env.GITHUB_REPOSITORY ?: "${env.JOB_NAME}"',
    "    def branch = env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'unknown-branch'",
    "    def commit = env.GIT_COMMIT ?: 'unknown-commit'",
    '    def sig = ("${repo}|${branch}|${commit}|${env.STAGE_NAME}|${log}").getBytes(\'UTF-8\')',
    "        .digest('SHA-256').collect { String.format('%02x', it) }.join()",
    "    def esc = { String s -> s.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n').replace('\\r', '\\\\r') }",
    '    def body = """{"projectKey":"${esc(key)}","repository":"${esc(repo)}","branch":"${esc(branch)}","commit":"${esc(commit)}","step":"${esc(env.STAGE_NAME)}","log":"${esc(log)}","idempotencyKey":"${sig}"}"""',
    '',
    '    def script = """',
    "        curl -s -m 20 -o /tmp/deja-vu.out -w '%{http_code}' -X POST '${url}' \\",
    "          -H 'Content-Type: application/json' --data-binary @- <<'DEJAVU_EOF'",
    '${body}',
    'DEJAVU_EOF',
    '    """',
    '    def code = sh(script: script, returnStdout: true).toString().trim()',
    "    if (code == '202' || code == '200') {",
    '        echo "[deja-vu] reported (HTTP ${code})"',
    '    } else {',
    '        echo "[deja-vu] Brain unreachable or refused (HTTP ${code}) — pipeline continues"',
    '    }',
    '}'];
}

/** Le helper et le bloc `post { failure { … } }` de `integrations/jenkins/`. */
export function jenkinsSnippet(payload: Record<string, unknown>): string {
  return [
    ...jenkinsHelper(),
    '',
    'post {',
    '    failure {',
    "        script { dejaVuReport('build.log') }",
    '    }',
    '}',
    '# Payload sent:',
    `# ${compact(payload)}`,
  ].join('\n');
}

/** La commande de la CLI npm (`integrations/cli/`). */
export function cliSnippet(payload: Record<string, unknown>, values: FormValues): string {
  return [
    'npm install -g deja-vu-ci',
    '',
    'deja-vu report \\',
    '  --url "$DEJAVU_BRAIN_URL" \\',
    '  --key "$DEJAVU_PROJECT_KEY" \\',
    `  --repo ${JSON.stringify(values.repository)} \\`,
    `  --branch ${JSON.stringify(values.branch)} \\`,
    `  --commit ${JSON.stringify(values.commit)} \\`,
    `  --step ${JSON.stringify(values.step)} \\`,
    '  --log build.log',
    '# Payload sent:',
    `# ${compact(payload)}`,
  ].join('\n');
}

/** L'appel du SDK Python (`integrations/python/deja_vu_ci.py`). */
export function pythonSnippet(payload: Record<string, unknown>, values: FormValues): string {
  return [
    'import os',
    'from deja_vu_ci import report',
    '',
    'result = report(',
    '    url=os.environ["DEJAVU_BRAIN_URL"],',
    '    key=os.environ["DEJAVU_PROJECT_KEY"],',
    `    repo=${JSON.stringify(values.repository)},`,
    `    branch=${JSON.stringify(values.branch)},`,
    `    commit=${JSON.stringify(values.commit)},`,
    `    step=${JSON.stringify(values.step)},`,
    '    log=open("build.log").read(),',
    ')',
    'print(result["ok"], result["status"], result["idempotency_key"])',
    '# Payload sent:',
    `# ${compact(payload)}`,
  ].join('\n');
}

/** Les six extraits, tous dérivés de la même charge utile. */
export function buildSnippets(payload: Record<string, unknown>, values: FormValues): Snippet[] {
  return [
    { id: 'curl', labelKey: 'universel.snippet.curl', text: curlSnippet(payload) },
    { id: 'github', labelKey: 'universel.snippet.github', text: githubActionSnippet(payload, values) },
    { id: 'gitlab', labelKey: 'universel.snippet.gitlab', text: gitlabSnippet(payload) },
    { id: 'jenkins', labelKey: 'universel.snippet.jenkins', text: jenkinsSnippet(payload) },
    { id: 'cli', labelKey: 'universel.snippet.cli', text: cliSnippet(payload, values) },
    { id: 'python', labelKey: 'universel.snippet.python', text: pythonSnippet(payload, values) },
  ];
}
