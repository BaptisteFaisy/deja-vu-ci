/**
 * Web trigger `/query` — the read path of the PR card (§ 14, screen 1).
 *
 * The Sensor asks, on behalf of the card: "what does the Brain know about
 * the latest failure of this branch?" The route is signed like `/ingest`,
 * stays read-only, and answers a `QueryResponse` within the 55 s budget —
 * one indexed SELECT and one call to the engine's single `diagnose`.
 *
 * This module also assembles the read-only payloads of the UI Kit screens
 * (lot G): the project page ("Mémoire de CI") and the issue context panel.
 */

import type { CostReport, Diagnostic, Occurrence, QueryResponse, Signature } from '@dejavu/core';
import { verifySignedRequest, jsonResponse } from './ingest';
import { validateQueryRequest } from './pure/validate';
import { migrateOnce, type BrainSqlStore } from './sql';
import type { BrainEngine } from './actions/engine';
import { allOccurrences, diagnoseFor, latestOccurrence, signatureForIssue } from './actions/context';
import { assembleIncident, type IncidentPanel } from './pure/incident';
import type { CostTrend } from './pure/costTrend';
import { computeCostTrend } from './pure/costTrendCompute';

/** Handler factory of the `/query` web trigger. */
export function createQueryHandler(store: BrainSqlStore, engine: BrainEngine) {
  return async function query(request: Request): Promise<Response> {
    try {
      const verified = await verifySignedRequest(request);
      if (!verified.ok) return verified.response;

      const parsed = validateQueryRequest(verified.payload);
      if (!parsed.ok) return jsonResponse(400, { ok: false, error: parsed.error });

      await migrateOnce();
      const { repository, branch, commit } = parsed.value;
      let occurrence = await store.latestOccurrence(repository, branch, commit);
      if (!occurrence && commit !== undefined) {
        // The exact commit is unknown: the card still deserves the latest
        // failure the Brain remembers for the branch.
        occurrence = await store.latestOccurrence(repository, branch);
      }
      const response = await buildQueryResponse(engine, occurrence);
      return jsonResponse(200, response);
    } catch (error) {
      return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

/** The `QueryResponse` of one occurrence — or "nothing known" without one. */
export async function buildQueryResponse(
  engine: BrainEngine,
  occurrence: Occurrence | undefined,
): Promise<QueryResponse> {
  if (!occurrence) return { ok: true };
  const diagnostic = await diagnoseFor(engine, occurrence);
  return { ok: true, diagnostic, lastFailureAt: occurrence.occurredAt };
}

/** Payload of the project page (§ 14, screen 3), assembled for lot G's UI. */
export interface MemoryPagePayload {
  signatures: Signature[];
  cost?: CostReport;
  /** The daily shape of the cost, and its variation against the previous window. */
  costTrend?: CostTrend;
  /** The infrastructure incident in progress, when there is one (CI-15). */
  incident?: IncidentPanel;
  pending?: Array<{ signatureId: string; commit: string; author: string; note?: string }>;
  shortIds?: Record<string, string>;
}

/** Resolver `memory-page`: signatures, cost, incident, pending, short ids. */
export async function memoryPageData(store: BrainSqlStore, engine: BrainEngine): Promise<
  { ok: true; data: MemoryPagePayload } | { ok: false; error: string }
> {
  try {
    await migrateOnce();
    const signatures = await store.listSignatures();
    const occurrences = await allOccurrences(engine);
    const pendingRows = await store.pendingResolutions();
    const settings = await store.getSettings();
    const now = engine.now();
    const shortIds: Record<string, string> = {};
    for (const signature of signatures) shortIds[signature.id] = engine.signatureShort(signature.id);
    const pending = pendingRows
      .filter((resolution) => !resolution.confirmedAt)
      .map((resolution) => ({
        signatureId: resolution.signatureId,
        commit: resolution.commit,
        author: resolution.author,
        ...(resolution.note ? { note: resolution.note } : {}),
      }));
    const incident = await assembleIncident(
      store,
      occurrences,
      settings,
      now,
      (id) => shortIds[id] ?? engine.signatureShort(id),
    );
    const data: MemoryPagePayload = {
      signatures,
      cost: engine.computeCost(occurrences, { signatures, now }),
      costTrend: computeCostTrend(occurrences, { signatures, now }),
      pending,
      shortIds,
    };
    if (incident) data.incident = incident;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Payload of the issue context panel (§ 14, screen 4). */
export interface IssueContextPayload {
  diagnostic?: Diagnostic;
  occurrences?: Occurrence[];
  problem?: boolean;
}

/**
 * Resolver `issue-context`: a problem ticket shows the occurrence table of
 * its signature; a development ticket shows the diagnosis of the latest
 * failure — through the same engine call as the PR card (single truth).
 */
export async function issueContextData(
  store: BrainSqlStore,
  engine: BrainEngine,
  issueKey: string,
): Promise<{ ok: true; data: IssueContextPayload } | { ok: false; error: string }> {
  try {
    await migrateOnce();
    const signature = await signatureForIssue(engine, issueKey);
    if (signature) {
      const occurrences = await store.listOccurrences(signature.id);
      const latest = latestOccurrence(occurrences);
      const diagnostic = latest ? await diagnoseFor(engine, latest) : undefined;
      return {
        ok: true,
        data: { problem: true, occurrences, ...(diagnostic ? { diagnostic } : {}) },
      };
    }
    return { ok: true, data: { problem: false } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
