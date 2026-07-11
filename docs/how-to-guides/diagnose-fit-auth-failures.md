# How to Diagnose a Forge Invocation Token (FIT) Auth Failure

Use this guide when a request to the remote backend's Forge-facing
endpoints (`/atlassian/installed`, `/a2a/json-rpc`, `/atlassian/config`) is
failing authentication, and you need to find out why. It assumes you
already understand the FIT-based trust model between Jira, Forge, and the
remote backend (see
[Explanation: Why this sample has three separate layers](../explanation/why-three-layers.md)
if you don't).

## 1. Check the remote backend logs first

`src/auth.ts` logs every auth outcome. Before guessing, look at what it
actually logged for the failing request:

- `"Auth failed: Missing or invalid authorization header"` — the request
  reached the backend with no `Authorization: Bearer <token>` header at
  all, or one that didn't start with `Bearer `.
- `"Auth failed: FIT verification failed"` — a bearer token was present but
  failed verification. The logged `error` and `statusCode` tell you which
  of the two cases below you're in.
- `"Auth succeeded"` — authentication is not your problem; look further
  down the request-handling path instead.

## 2. If the header was missing entirely

If you don't have any `Authorization` header, the request almost certainly
didn't come from Jira through your Forge app. Common causes, in order of
likelihood:

- **You called the endpoint directly**, for example with a bare `curl`
  against `/a2a/json-rpc`. This is expected to fail: FITs are minted by
  Forge and attached automatically when Jira invokes your app. There is no
  way to construct a valid one outside that flow. Use `npm test` (see
  [`apps/remote/README.md`](../../apps/remote/README.md#exploring-the-simulated-streaming-behavior))
  to exercise the endpoint instead, or drive it through a real Jira
  interaction.
- **`REMOTE_SERVICE_URL` in `apps/forge/.env` doesn't point at this
  backend.** If Forge is forwarding requests somewhere else entirely, this
  backend never receives an `Authorization` header for you to inspect, and
  you may be looking at the wrong service's logs.

## 3. If verification failed with a 401 and a Problem Details body

This means a bearer token arrived but didn't validate as a genuine Forge
Invocation Token. Check, in order:

1. **Redeploy/reinstall drift.** If you changed `remotes`, `auth`, or scope
   settings in `apps/forge/manifest.yml` and didn't redeploy and
   reinstall, Jira may be issuing tokens against a stale contract. Run:

   ```bash
   npm run forge:deploy
   npm run forge:install
   ```

2. **Tunnel URL changed underneath you.** If you're using `zrok` without a
   reserved share, or restarted a reserved share and it issued a new
   hostname, `REMOTE_SERVICE_URL` in `apps/forge/.env` may no longer match
   where Forge thinks your backend lives, or the backend may have moved
   out from under an already-issued token's expectations. Confirm the
   value in `apps/forge/.env` matches the backend's current public HTTPS
   URL, then redeploy.
3. **Token expiry or clock skew**, if the above two don't explain it. FITs
   are short-lived; a retried or replayed request from significantly
   later than when Jira issued it will fail verification on that basis
   alone.

## 4. If the backend returned a 502 instead of a 401

`authMiddleware` deliberately reclassifies TLS or network-level failures
during token verification as `502 Bad Gateway`, not `401`. If you're
seeing `502`, do not spend time inspecting the token itself — the failure
happened before verification could evaluate it. Check instead:

- whether the backend's outbound HTTPS connectivity to Atlassian's
  verification service is currently working from wherever the backend is
  running
- whether a local proxy, firewall, or corporate network is intercepting
  outbound TLS connections from the backend process

## 5. If you're running multiple Jira sites against one backend

Confirm the FIT's `context.cloudId` (visible in the decoded payload, or in
your own added logging) matches an installation this backend actually has
a record for. A token that verifies successfully but references an
installation the backend never recorded — for example, because
`/atlassian/installed` failed earlier for that site — will surface as a
downstream "installation not found" problem, not an auth failure, even
though the root cause is upstream in the install flow.

## Related docs

- [`apps/remote/src/auth.ts`](../../apps/remote/src/auth.ts) — the
  middleware referenced throughout this guide
- [`apps/forge/README.md`](../../apps/forge/README.md#remote-backend) —
  the manifest fields that control token issuance and forwarding
- [Reference: A2A JSON-RPC endpoint](../reference/a2a-json-rpc-endpoint.md) —
  headers and error codes for the endpoint this auth failure is blocking
