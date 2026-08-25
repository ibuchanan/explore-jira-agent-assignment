# Forge app for the remote agent

This workspace contains the installable Forge component of the reference
implementation. Its [`manifest.yml`](manifest.yml) declares the Jira
`rovo:agentConnector` module and points its A2A 1.0 JSON-RPC transport at the
remote backend.

The Forge app is middleware, not the agent runtime. The remote service owns
A2A task handling and agent work; this app makes that remote available to Jira.

## What the manifest declares

- a Jira-only agent named **Agent Simulator**;
- A2A protocol version `1.0`;
- a JSON-RPC endpoint at `/a2a/json-rpc` forwarded to the configured remote;
- streaming support, so Jira can use `SendStreamingMessage`; and
- the `read:jira-work` scope used by the sample.

`REMOTE_BASE_URL` supplies the remote's public HTTPS base URL at deployment
time. The local development workflow writes it after creating a Cloudflare
Quick Tunnel; see [DEVELOPMENT.md](../../DEVELOPMENT.md).

## Architecture role

```text
Jira Cloud
  │ invokes the installed connector
  ▼
Forge app
  │ forwards A2A JSON-RPC to the Forge remote endpoint
  ▼
Remote A2A service
```

The remote validates the Forge Invocation Token attached to each request before
it dispatches the request to its A2A handler. This manifest does **not** request
app-system or app-user access-token forwarding; add and document those remote
authentication settings only if your agent needs to call Jira APIs.

## Transport selection

The manifest sets `protocols.agent2Agent.jsonRpcTransport.streaming: true`.
That opts this connector into streaming, allowing Jira to send
`SendStreamingMessage` and receive SSE updates. The remote Agent Card also
advertises streaming support. Both declarations are needed to represent the
sample's streaming capability.

For delivery-model guidance, see [Polling vs Streaming](../../docs/explanation/polling-vs-streaming.md).
