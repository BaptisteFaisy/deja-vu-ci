# Key rotation of the signed bridge (no downtime)

The Sensor → Brain bridge authenticates every request with an HMAC-SHA256
signature over `"<ts>.<nonce>.<body>"`, using a shared secret established at
pairing time and stored in Forge's secret storage. This document describes how
to rotate that secret **without dropping in-flight messages**.

## The problem rotation solves

A naive rotation (replace the secret everywhere at once) creates a window in
which:

- the Sensor signs with the new key while the Brain still verifies with the old
  one, or
- a message signed just before the rotation arrives just after it.

Either way the HMAC check fails and the request is refused with a `401`. The
bridge avoids this by accepting a **set** of keys during an overlap period.

## The key set

`verifyRequest` accepts either a single secret (the original, fully
backward-compatible call) or a `SecretSet`:

```ts
interface SecretSet {
  /** Active key first (it signs); the rest verify only, during the overlap. */
  secrets: string[];
}
```

- **Signing** always uses `secrets[0]` (the active key).
- **Verification** tries every key in the set, in order, with a constant-time
  comparison. A message signed by any key still in the set is accepted.

A single string secret is treated as `{ secrets: [secret] }`, so existing
callers are unaffected.

## Rotating a key

`rotateSecret(current, nextSecret)` is a **pure** function (no clock, no
storage). It returns a new set whose active key is `nextSecret` and which keeps
the previous active key, so both are accepted during the overlap:

```ts
import { rotateSecret, signPayload, verifyRequest } from '@dejavu/bridge';

const before = { secrets: [OLD] };
const after = rotateSecret(before, NEW); // { secrets: [NEW, OLD] }

// The Sensor signs with the active key…
const { body, headers } = signPayload(payload, after);
// …and the Brain accepts the new key AND any message still signed with OLD.
verifyRequest(headers, body, after);
```

Rotating again keeps the chain: `rotateSecret({ secrets: [NEW, OLD] }, NEWER)`
gives `{ secrets: [NEWER, NEW, OLD] }`.

## Recommended procedure

1. **Generate** a fresh secret (at least 32 random bytes) and store it in
   Forge's secret storage under a new id; keep the old one for now.
2. **Widen the Brain** to verify with `{ secrets: [NEW, OLD] }` (deploy this
   first, so the Brain already accepts the new key before the Sensor uses it).
3. **Switch the Sensor** to sign with `NEW` (it becomes `secrets[0]`).
4. **Wait out the overlap** — long enough for every message signed with `OLD`
   to have arrived. The bridge timestamp window is ±300 s by default, so an
   overlap of a few minutes covers in-flight traffic; allow more for a retried
   queue.
5. **Close the window**: drop `OLD` and verify with `{ secrets: [NEW] }` only.
   From this point a message signed with `OLD` is refused.
6. **Delete** the old secret from storage.

The overlap period is operational: it is simply how long the retired key stays
in the set. `rotateSecret` never expires a key on its own (it is pure), so the
operator decides when to close the window (step 5).

## What is and is not guaranteed

- A refusal reason never reveals a secret, a key id, or the expected nonce; the
  attack suite (`packages/bridge/test/attacks.test.ts`) asserts this.
- Rotation does not weaken replay protection: the nonce and timestamp checks
  are unchanged and apply to every key in the set.
- Keeping a retired key accepted is a deliberate, time-bounded trade-off. Close
  the window (step 5) as soon as the overlap is over.
