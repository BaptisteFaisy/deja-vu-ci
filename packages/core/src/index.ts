/**
 * Public API of the Déjà-vu engine.
 *
 * Everything the two Forge apps, the CLI tools and the tests need, in one
 * barrel: the engine itself has **no** dependency on Forge, so it runs
 * unchanged in a Jira resolver, in a Bitbucket trigger, in `npm run replay`
 * and under vitest.
 *
 * Layering (§ 9 → § 10 → § 11):
 *   mask → extract → normalize → categorize → sign   (what the error is)
 *   flaky, outbreak, diagnose                        (what it means)
 *   resolutions, tickets, cost                       (what to do about it)
 *   store, replay, llm, universal                    (where it lives)
 */

export * from './types.js';
export * from './types-data.js';

// What the error is (§ 9).
export * from './mask.js';
export * from './extract.js';
export * from './normalize.js';
export * from './categorize.js';
export * from './sign.js';

// What it means (§ 10).
export * from './flaky.js';
export * from './outbreak.js';
export * from './diagnose.js';

// What to do about it (§ 11, CI-14).
export * from './resolutions.js';
export * from './tickets.js';
export * from './cost.js';

// Manual curation of signatures (§ 19, CI-17).
export * from './curate.js';

// Where it lives (§ 15, § 16, CI-11, CI-16).
export * from './store.js';
export * from './replay.js';
export * from './engine.js';
export * from './llm.js';
export * from './universal.js';
export * from './quarantine.js';
