/**
 * Agent Rovo « Déjà-vu CI » (§ 13).
 *
 * L'agent répond aux questions des développeurs et des agents de code avec un
 * **diagnostic** et une **action**, jamais avec une supposition. Il cite le
 * ticket quand il y en a un, et ne dit jamais « sans rapport avec ta PR »
 * sous le seuil de confiance : le moteur a déjà dégradé ces verdicts en
 * « incertain », l'agent ne les réécrit pas.
 */

import type { ActionDescriptor, RawInput } from '../actions/descriptor';
import type { BrainEngine } from '../actions/engine';
import { explainBuildFailure } from '../actions/explain-build-failure';
import { searchFailures } from '../actions/search-failures';
import { getSignature } from '../actions/get-signature';
import { listFlakyTests } from '../actions/list-flaky-tests';
import { reportResolution } from '../actions/report-resolution';
import { confirmResolution } from '../actions/confirm-resolution';

/** Instruction système de l'agent, en anglais (jury anglophone). */
export const AGENT_INSTRUCTIONS = [
  'You are Déjà-vu CI, the CI memory of this Jira project.',
  'A red build is rarely new: before saying a failure is unknown, look it up in the memory.',
  'Always answer with a diagnosis and one action to take (retry, rebase, fix, wait, none).',
  'Always cite the Jira ticket of the problem when there is one, and the fix (commit and author) when the failure was already fixed.',
  'Never state that a failure is unrelated to the pull request unless the engine says so with a confidence above its own threshold: below it, say the verdict is uncertain and show the facts.',
  'Never invent a commit, an author or a ticket. If the memory does not know, say so.',
  'Answer in the language of the question.',
].join(' ');

/** Les quatre questions types du § 13. */
export const TYPICAL_QUESTIONS: Array<{ question: string; action: string; inputs: RawInput }> = [
  {
    question: 'Why is the build of PAY-123 red?',
    action: 'explain-build-failure',
    inputs: { issueKey: 'PAY-123' },
  },
  {
    question: 'Have we already seen this error?',
    action: 'search-failures',
    inputs: { text: '<paste the error excerpt here>' },
  },
  {
    question: 'What are our most flaky tests?',
    action: 'list-flaky-tests',
    inputs: { repository: '<repository slug>', days: 14 },
  },
  {
    question: 'Who fixed the database connection error last time?',
    action: 'search-failures',
    inputs: { text: '<paste the database connection error here>' },
  },
];

/** Les six actions câblées dans l'agent. */
export const AGENT_ACTIONS = {
  'explain-build-failure': explainBuildFailure,
  'search-failures': searchFailures,
  'get-signature': getSignature,
  'list-flaky-tests': listFlakyTests,
  'report-resolution': reportResolution,
  'confirm-resolution': confirmResolution,
} as const;

/** Clé d'une action de l'agent. */
export type AgentActionKey = keyof typeof AGENT_ACTIONS;

/** Action demandée par l'agent. */
export type AgentAction = ActionDescriptor<unknown>;

/** Exécute une action de l'agent par son nom de clé. */
export async function runAgentAction(
  engine: BrainEngine,
  key: string,
  inputs: RawInput,
): Promise<unknown> {
  const action = AGENT_ACTIONS[key as AgentActionKey];
  if (!action) return { ok: false, error: `unknown action: ${key}` };
  return action(engine, inputs);
}

/** Description de l'agent, telle que le manifeste Forge la déclare. */
export function describeAgent(): {
  name: string;
  instructions: string;
  actions: Array<{ key: string; description: string; inputs: unknown }>;
} {
  return {
    name: 'Déjà-vu CI',
    instructions: AGENT_INSTRUCTIONS,
    actions: Object.values(AGENT_ACTIONS).map((action) => ({
      key: action.key,
      description: action.description,
      inputs: action.inputs,
    })),
  };
}
