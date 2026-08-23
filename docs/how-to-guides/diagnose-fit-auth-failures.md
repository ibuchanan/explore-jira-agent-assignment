# How to Diagnose a Forge Invocation Token (FIT) Auth Failure

Use this guide when a Jira request to the remote A2A endpoint fails before the
agent handles it.

## Confirm the request reaches the correct endpoint

The active route is `POST /a2a/json-rpc`. The Forge endpoint in
[`apps/forge/manifest.yml`](../../apps/forge/manifest.yml) maps that route to
the configured remote.

A healthy request produces these remote log messages in order:

```text
[HTTP] request received
[Forge Remote/FIT] invocation token validation started
[Forge Remote/FIT] invocation token validated
[JSON-RPC] request dispatched to A2A handler
```

If the first message is absent, inspect the remote URL and tunnel. If the
request is logged on a different path, inspect the Forge endpoint route.

## Identify token-validation failures

If the log reaches `invocation token validation started` but not `invocation
token validated`, FIT verification rejected the request. Check the following:

- The remote service was started with the correct `FORGE_APP_ID`. The server
  uses it to construct the expected Forge app audience.
- The Forge app was deployed after changes to the remote, endpoint, or
  permissions configuration.
- The installation was upgraded after any scope changes.
- `REMOTE_BASE_URL` resolves to the currently running, public HTTPS remote.
  Update the Forge environment variable and redeploy if a tunnel URL changed.

Do not manufacture or paste a FIT into a direct HTTP request. Forge issues the
invocation token when Jira calls the configured remote.

## Distinguish authentication from A2A failures

When `invocation token validated` appears, FIT authentication succeeded. Any
following error is in JSON-RPC routing, scenario playback, or agent behavior,
not token validation.

Use the local remote tests for request-shape and scenario behavior:

```bash
npm run --workspace=rovo-agent-connector-remote-backend test
```

Use a real Jira interaction to exercise Forge-issued FIT validation end to
end.

## Check the deployed configuration

The relevant configuration is intentionally small:

- [`apps/forge/manifest.yml`](../../apps/forge/manifest.yml) declares the
  `rovo:agentConnector`, its `agent2Agent` protocol version, and the endpoint
  mapping.
- [`apps/remote/src/server.ts`](../../apps/remote/src/server.ts) mounts the
  FIT middleware and A2A handler at `/a2a/json-rpc`.
- [`apps/remote/src/index.ts`](../../apps/remote/src/index.ts) reports a
  startup failure when `FORGE_APP_ID` is missing.

For the architectural role of those pieces, see [How a Jira remote agent
connector works](../explanation/rovo-agent-connector.md).
