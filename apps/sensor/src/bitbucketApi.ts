/**
 * The Forge binding of the Bitbucket reader.
 *
 * This is the only file of the Sensor that talks to `@forge/api`: the
 * reading logic (`pipelines.ts`) takes the reader as a parameter, so it can
 * be rehearsed without Forge and without the network.
 *
 * `assumeTrustedRoute` is used because every path is built in `pipelines.ts`
 * from values that come from Bitbucket itself (workspace, repository,
 * pipeline and step uuids), each of them URL-encoded one by one.
 */

import { assumeTrustedRoute, requestBitbucket } from '@forge/api';
import type { ApiAnswer, BitbucketReader } from './pipelines';

/** Reads a header without depending on its case. */
function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}

/** The Bitbucket reader backed by the Forge product client. */
export const bitbucketReader: BitbucketReader = async (
  path: string,
  init: { headers?: Record<string, string> } = {},
): Promise<ApiAnswer> => {
  const response = await requestBitbucket(assumeTrustedRoute(path), {
    headers: init.headers ?? {},
  });
  return {
    ok: response.ok,
    status: response.status,
    contentRange: headerValue(response.headers, 'content-range'),
    text: () => response.text(),
    json: () => response.json(),
  };
};
