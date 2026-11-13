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
import type { MinimizePolicy } from './pure/excerptPolicy';
import { planAndApplyTickets, type ConsumerDeps } from './pure/consume';
import { recordAudit } from './pure/auditLog';
import { coreConsumerEngine, jiraTicketApplier } from './consumer';
import { loadExcerptPolicy, loadSettings } from './settings';
import { resolveProjectTarget } from './pure/projectTarget';
import { migrateOnce, type BrainSqlStore } from './sql';

/** Summary of one daily run. */
export type ScheduledAnswer =
  | { ok: true; purged: number; families: number; outbreaks: number; comments: number }
  | { ok: false; error: string };

/** Deps extended with the settings of the run (read once). */
interface RunDeps extends ConsumerDeps {
  settings: Settings;
}

/**
 * Remembers the purge of the day: its date feeds the health panel ("last
 * purge"), and one journal line tells the operator what was removed. Both are
 * best-effort — the purge itself already happened.
 */
async function recordPurge(
  store: BrainSqlStore,
  policy: MinimizePolicy,
  purged: number,
  now: Date,
): Promise<void> {
  try {
    await store.saveAppPolicy(policy, now.toISOString());
    await recordAudit(store, {
      action: 'excerpts-purged',
      detail: `${purged} raw excerpt(s) removed`,
      at: now,
    });
  } catch {
    // The journal never breaks the daily run.
  }
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
      const [settings, policy] = await Promise.all([
        loadSettings(store),
        loadExcerptPolicy(store),
      ]);
      const purged = await store.purgeExpired(now);
      await recordPurge(store, policy, purged, now);
      const deps: RunDeps = {
        store,
        engine: coreConsumerEngine(),
        // The daily run has no screen context: the target is the register
        // alone. An empty register means no ticket is created (fail-closed).
        tickets: jiraTicketApplier(resolveProjectTarget({ chosen: settings.issueProjectKey }), {
          audit: store,
          now: () => now,
        }),
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
