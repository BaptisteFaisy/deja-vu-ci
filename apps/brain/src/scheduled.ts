/**
 * Scheduled trigger — the daily housekeeping of the Brain (§ 11, § 10.3).
 *
 * Once a day (manifest `interval: day`), inside the 900 s async budget:
 *  1. purge the raw excerpts whose retention expired (`purgeExpired`),
 *  2. detect infrastructure outbreaks per family (`detectOutbreak`),
 *  3. publish the daily synthesis on every problem ticket and suggest the
 *     closures — through the very same planner and applier as the consumer
 *     (`planTicketActions` + `planAndApplyTickets`): one comment per day per
 *     ticket is guaranteed by the planner's brake, read from Jira itself.
 *
 * No exception escapes: the run answers a summary or an explicit error.
 */

import type { Occurrence, Settings, Signature } from '@dejavu/core';
import { planAndApplyTickets, type ConsumerDeps } from './pure/consume.js';
import { coreConsumerEngine, jiraTicketApplier } from './consumer.js';
import { loadSettings } from './settings.js';
import { migrateOnce, type BrainSqlStore } from './sql.js';

/** Summary of one daily run. */
export type ScheduledAnswer =
  | { ok: true; purged: number; families: number; outbreaks: number; comments: number }
  | { ok: false; error: string };

/** Deps extended with the settings of the run (read once). */
interface RunDeps extends ConsumerDeps {
  settings: Settings;
}

/** Detects and stores the outbreak of one family, returns true when new. */
async function refreshOutbreak(deps: RunDeps, familyId: string, occurrences: Occurrence[]): Promise<boolean> {
  const outbreak = deps.engine.detectOutbreak(occurrences, {
    settings: deps.settings,
    now: deps.now(),
  });
  if (!outbreak) return false;
  const known = await deps.store.findOutbreak(familyId);
  if (known && known.startedAt === outbreak.startedAt) return false;
  await deps.store.saveOutbreak(outbreak);
  return true;
}

/** Processes one problem signature: outbreak, synthesis, closure suggestion. */
async function processSignature(
  deps: RunDeps,
  signature: Signature,
): Promise<{ outbreaks: number; comments: number }> {
  const occurrences = await deps.store.listOccurrences(signature.id);
  let outbreaks = 0;
  if (await refreshOutbreak(deps, signature.familyId, occurrences)) outbreaks += 1;
  if (!signature.issueKey) return { outbreaks, comments: 0 };

  const verdict = deps.engine.assessFlakiness(occurrences, {
    settings: deps.settings,
    now: deps.now(),
  });
  const planned = await planAndApplyTickets(deps, signature, occurrences, verdict, deps.settings);
  const comments = planned.actions.filter((a) => a.kind === 'comment' || a.kind === 'close-suggested').length;
  return { outbreaks, comments };
}

/** Handler factory of the daily scheduled trigger. */
export function createScheduledHandler(store: BrainSqlStore) {
  return async function scheduled(): Promise<ScheduledAnswer> {
    try {
      await migrateOnce();
      const now = new Date();
      const settings = await loadSettings(store);
      const purged = await store.purgeExpired(now);
      const deps: RunDeps = {
        store,
        engine: coreConsumerEngine(),
        tickets: jiraTicketApplier(settings),
        now: () => now,
        settings,
      };

      const signatures = await store.listSignatures();
      let families = 0;
      let outbreaks = 0;
      let comments = 0;
      for (const signature of signatures) {
        const result = await processSignature(deps, signature);
        outbreaks += result.outbreaks;
        comments += result.comments;
        families += 1;
      }
      return { ok: true, purged, families, outbreaks, comments };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
