/**
 * Les six actions du Cerveau (§ 13) — point d'entrée unique.
 *
 * Les six noms exportés sont **exactement** les six noms du contrat :
 * `explain-build-failure`, `search-failures`, `get-signature`,
 * `list-flaky-tests`, `report-resolution`, `confirm-resolution`.
 *
 * Ces noms sont des noms de module arbitraires (ES2022) : ils portent un
 * trait d'union, comme les clés d'actions du manifeste Forge et comme celles
 * du serveur `rovo:mcp`. Les gestionnaires de `apps/brain/src/index.ts`
 * s'en servent ainsi :
 *
 * ```ts
 * import * as actions from './actions/index';
 * export const explainBuildFailure = async (payload) =>
 *   actions['explain-build-failure'](engine, payload);
 * ```
 */

export { explainBuildFailure as 'explain-build-failure' } from './explain-build-failure';
export { searchFailures as 'search-failures' } from './search-failures';
export { getSignature as 'get-signature' } from './get-signature';
export { listFlakyTests as 'list-flaky-tests' } from './list-flaky-tests';
export { reportResolution as 'report-resolution' } from './report-resolution';
export { confirmResolution as 'confirm-resolution' } from './confirm-resolution';
