/**
 * The "incident in progress" panel of the CI Memory page (CI-15, § 10.3).
 *
 * The engine already detects infrastructure outbreaks (`detectOutbreak`): the
 * same family of failures on several repositories inside a short window. This
 * module turns that detection into what the panel shows — the families hit,
 * the repositories, the window, the single ticket of the incident (§ 11: one
 * ticket per family) and the moment it started.
 *
 * Nothing is recomputed here: the outbreak comes from the engine, the ticket
 * comes from the memory. No outbreak means no panel — the screen renders its
 * explicit empty state instead of a ghost block.
 *
 * Pure module: no `@forge/*` import, no network.
 */

import { detectOutbreak, type Occurrence, type Outbreak, type Settings, type Signature } from '@dejavu/core';

/** What the panel shows while an infrastructure incident is running. */
export interface IncidentPanel {
  /** Family of the incident — the unit that owns the single ticket. */
  familyId: string;
  /** Signature the incident is attached to (the one holding the ticket). */
  signatureId: string;
  /** Readable id of that signature (`S-204`). */
  signatureShort: string;
  /** Repositories hit by the incident, sorted. */
  repos: string[];
  /** Start of the incident (ISO-8601). */
  startedAt: string;
  /** Last failure of the incident (ISO-8601). */
  lastSeenAt: string;
  /** Width of the detection window, in minutes (§ 10.3). */
  windowMinutes: number;
  /** The unique ticket of the incident, when the family already has one. */
  issueKey?: string;
  /** How many failures the incident counts. */
  occurrences: number;
}

/** The read side of the memory the panel needs (the core `Store` satisfies it). */
export interface IncidentReadStore {
  findSignaturesByFamily(familyId: string): Promise<Signature[]>;
  findOutbreak(familyId: string): Promise<Outbreak | undefined>;
}

/** A minute, in milliseconds. */
const MINUTE_MS = 60 * 1000;

/** Groups the occurrences by family, oldest first inside a family. */
export function groupByFamily(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const byFamily = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const group = byFamily.get(occurrence.familyId);
    if (group) group.push(occurrence);
    else byFamily.set(occurrence.familyId, [occurrence]);
  }
  for (const group of byFamily.values()) {
    group.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  }
  return byFamily;
}

/** The failures that fall inside the detection window of one incident. */
export function incidentOccurrences(
  occurrences: Occurrence[],
  startedAt: string,
  windowMinutes: number,
): Occurrence[] {
  const start = Date.parse(startedAt);
  const end = start + windowMinutes * MINUTE_MS;
  return occurrences.filter((occurrence) => {
    const at = Date.parse(occurrence.occurredAt);
    return Number.isFinite(at) && at >= start && at <= end;
  });
}

/** The signature of a family that carries the ticket: most occurrences first. */
export function ticketSignature(signatures: Signature[]): Signature | undefined {
  const withTicket = signatures.filter((signature) => signature.issueKey);
  if (withTicket.length === 0) return signatures[0];
  return [...withTicket].sort((a, b) => b.occurrences - a.occurrences)[0];
}

/** Stronger incident wins: more repositories, then the earliest start. */
export function isStronger(candidate: IncidentPanel, current: IncidentPanel): boolean {
  if (candidate.repos.length !== current.repos.length) {
    return candidate.repos.length > current.repos.length;
  }
  return Date.parse(candidate.startedAt) < Date.parse(current.startedAt);
}

/** Builds the panel of one family, or undefined when it is not an incident. */
async function panelForFamily(
  store: IncidentReadStore,
  familyId: string,
  occurrences: Occurrence[],
  settings: Settings,
  now: Date,
  shortId: (id: string) => string,
): Promise<IncidentPanel | undefined> {
  const outbreak = detectOutbreak(occurrences, { settings, now });
  if (!outbreak) return undefined;

  const windowMinutes = settings.outbreakWindowMin;
  const inside = incidentOccurrences(occurrences, outbreak.startedAt, windowMinutes);
  const lastSeenAt = inside.reduce(
    (latest, occurrence) => (occurrence.occurredAt > latest ? occurrence.occurredAt : latest),
    outbreak.startedAt,
  );

  const [signatures, stored] = await Promise.all([
    store.findSignaturesByFamily(familyId),
    store.findOutbreak(familyId),
  ]);
  const holder = ticketSignature(signatures);
  const issueKey = stored?.incidentKey ?? holder?.issueKey;

  const panel: IncidentPanel = {
    familyId,
    signatureId: holder?.id ?? familyId,
    signatureShort: shortId(holder?.id ?? familyId),
    repos: [...outbreak.repos].sort(),
    startedAt: outbreak.startedAt,
    lastSeenAt,
    windowMinutes,
    occurrences: inside.length,
  };
  if (issueKey) panel.issueKey = issueKey;
  return panel;
}

/**
 * Assembles the panel of the running incident, if any.
 *
 * Every family of the memory is examined with the engine's own detector, and
 * the strongest incident (most repositories, then earliest) is the one shown:
 * an installation has one incident panel, never one per family.
 */
export async function assembleIncident(
  store: IncidentReadStore,
  occurrences: Occurrence[],
  settings: Settings,
  now: Date,
  shortId: (id: string) => string,
): Promise<IncidentPanel | undefined> {
  let strongest: IncidentPanel | undefined;
  for (const [familyId, familyOccurrences] of groupByFamily(occurrences)) {
    const panel = await panelForFamily(
      store,
      familyId,
      familyOccurrences,
      settings,
      now,
      shortId,
    );
    if (!panel) continue;
    if (!strongest || isStronger(panel, strongest)) strongest = panel;
  }
  return strongest;
}
