/**
 * Public API of the presentation package.
 *
 * The vocabulary the two Forge apps have in common — language, domain
 * labels, formatters, screen routing — lives here exactly once: the Brain
 * (Jira) and the Sensor (Bitbucket) display the same diagnostic with the
 * same words (§ 14, § 18).
 *
 * No Forge import, no React import, no `node:*` import: the package is pure,
 * so it is unit-tested at the repository root and bundled unchanged into
 * either app.
 */

export * from './lang.js';
export * from './labels.js';
export * from './format.js';
export * from './screens.js';
export * from './invoke.js';
