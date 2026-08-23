import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";

import type {
  RemoteLogRecord,
  RemoteLogRecordLogger,
} from "@forge-ahead/remote/logging";
import type { LoadedScenario } from "../src/scenarios.js";
import { createA2aServer } from "../src/server.js";

type RequestOptions = {
  body: string;
  contentType?: string;
  path?: string;
  token?: string;
};
type CompletedResponse = {
  result: {
    task: {
      contextId: string;
      id: string;
      status: {
        message: {
          contextId: string;
          messageId: string;
          parts: unknown[];
          role: string;
          taskId: string;
        };
        state: string;
        timestamp: string;
      };
    };
  };
};
type DiagnosticEvent = Record<string, unknown>;
type Fixture = {
  request(options: RequestOptions): Promise<Response>;
  token(): string;
};

function base64url(value: string | object): string {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");
}

async function signedFit(
  privateKey: Parameters<typeof crypto.subtle.sign>[1],
  payload: Record<string, unknown>,
): Promise<string> {
  const header = base64url({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const body = base64url(payload);
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  ).toString("base64url");
  return `${header}.${body}.${signature}`;
}

async function url(server: Server): Promise<string> {
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (
        (error as NodeJS.ErrnoException | undefined)?.code ===
        "ERR_SERVER_NOT_RUNNING"
      ) {
        resolve();
      } else if (error) {
        reject(error);
      } else {
        resolve();
      }
    }),
  );
}

async function createFixture(
  t: TestContext,
  {
    appAri = "app",
    appId,
    diagnostics,
    scenarios,
    enableRealJiraCallbacks,
    jiraFetch,
    remoteLogger,
    fitClaims = {},
  }: {
    appAri?: string;
    appId?: string;
    diagnostics?: (event: DiagnosticEvent) => void;
    scenarios?: LoadedScenario[];
    enableRealJiraCallbacks?: boolean;
    jiraFetch?: typeof fetch;
    remoteLogger?: RemoteLogRecordLogger;
    fitClaims?: Record<string, unknown>;
  } = {},
): Promise<Fixture> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair)) throw new Error("expected RSA key pair");
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const audience = appId ? `ari:cloud:ecosystem::app/${appId}` : appAri;
  const token = await signedFit(keyPair.privateKey, {
    ...fitClaims,
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 60,
    iss: "forge/invocation-token",
  });
  const jwks = createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        keys: [
          {
            ...publicKey,
            kid: "test-key",
            use: "sig",
            alg: "RS256",
          },
        ],
      }),
    );
  });
  jwks.listen(0, "127.0.0.1");
  const jwksUrl = `${await url(jwks)}/jwks`;
  t.after(() => close(jwks));

  const appResult = createA2aServer({
    ...(appId ? { appId } : { appAri }),
    delay: (milliseconds: number) =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.min(milliseconds, 100)),
      ),
    jwksUrl,
    ...(diagnostics ? { diagnostics } : {}),
    ...(scenarios ? { scenarios } : {}),
    ...(enableRealJiraCallbacks ? { enableRealJiraCallbacks } : {}),
    ...(jiraFetch ? { jiraFetch } : {}),
    ...(remoteLogger ? { remoteLogger } : {}),
  } as never);
  assert.equal(appResult.isOk(), true);
  if (appResult.isErr()) return assert.fail(appResult.error.detail);

  const server = appResult.value.listen(0, "127.0.0.1");
  const baseUrl = await url(server);
  t.after(() => close(server));

  return {
    token: () => token,
    request: ({
      token,
      body,
      path = "/a2a/json-rpc",
      contentType = "application/json",
    }: RequestOptions) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "a2a-version": "1.0",
          "content-type": contentType,
          "x-forge-oauth-user": "validated-user-token",
        },
        body,
      }),
  };
}

test("returns a configuration error instead of throwing", () => {
  const result = createA2aServer({ appAri: "" });

  assert.equal(result.isErr(), true);
  if (result.isOk()) return assert.fail("expected a configuration error");
  assert.equal(result.error.status, 500);
  assert.equal(result.error.detail, "FORGE_APP_ID is required");
});

test("rejects a scenario collection without a default before accepting tasks", () => {
  const result = createA2aServer({ appId: "test", scenarios: [] });

  assert.equal(result.isErr(), true);
  if (result.isOk()) return assert.fail("expected a configuration error");
  assert.equal(result.error.status, 400);
  assert.match(result.error.detail ?? "", /exactly one Default Scenario/);
});

test("returns the default scenario task for a verified SendMessage request", async (t) => {
  const { request, token } = await createFixture(t, { appId: "test" });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "request-123",
      method: "SendMessage",
      params: {
        message: {
          contextId: "context-456",
          messageId: "message-123",
          role: "ROLE_USER",
          parts: [{ text: "do not echo this" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as CompletedResponse & {
    id: string;
    jsonrpc: string;
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "request-123");
  assert.ok(body.result, JSON.stringify(body));
  assert.equal(body.result.task.contextId, "context-456");
  assert.match(body.result.task.id, /^[0-9a-f-]{36}$/i);
  assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(body.result.task.status.message.parts, [
    {
      mediaType: "text/markdown",
      metadata: {},
      text: "**Finished the task.**",
    },
  ]);
  assert.equal(body.result.task.status.message.role, "ROLE_AGENT");
  assert.equal(body.result.task.status.message.taskId, body.result.task.id);
  assert.equal(body.result.task.status.message.contextId, "context-456");
  assert.match(body.result.task.status.message.messageId, /^[0-9a-f-]{36}$/i);
  assert.match(body.result.task.status.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("emits safe structured logs for authenticated completed tasks", async (t) => {
  const records: RemoteLogRecord[] = [];
  const remoteLogger: RemoteLogRecordLogger = {
    debug: (record) => records.push(record),
    info: (record) => records.push(record),
    warn: (record) => records.push(record),
    error: (record) => records.push(record),
  };
  const { request, token } = await createFixture(t, { remoteLogger });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "logging-request",
      method: "SendMessage",
      params: {
        message: {
          contextId: "logging-context",
          messageId: "logging-message",
          role: "ROLE_USER",
          parts: [{ text: "log this task" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const completed = (await response.json()) as CompletedResponse;
  const auth = records.find(
    (record) => record.event === "remote.auth.accepted",
  );
  const terminal = records.find(
    (record) => record.event === "remote.a2a.completed",
  );
  assert.deepEqual(auth?.remoteContext.forwardedTokens, {
    hasSystemToken: false,
    hasUserToken: true,
  });
  assert.doesNotMatch(JSON.stringify(auth), /validated-user-token/);
  assert.deepEqual(terminal?.a2a, {
    contextId: "logging-context",
    final: true,
    state: "TASK_STATE_COMPLETED",
    taskId: completed.result.task.id,
  });
});

test("runs the default scenario for an unmatched SendMessage", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "default-scenario",
      method: "SendMessage",
      params: {
        message: {
          contextId: "default-context",
          messageId: "default-message",
          role: "ROLE_USER",
          parts: [{ text: "A task without a matching scenario" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as CompletedResponse;
  assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(body.result.task.status.message.parts, [
    {
      mediaType: "text/markdown",
      metadata: {},
      text: "**Finished the task.**",
    },
  ]);
});

test("selects the first case-insensitive matching scenario", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "matched-scenario",
      method: "SendMessage",
      params: {
        message: {
          contextId: "match-context",
          messageId: "match-message",
          role: "ROLE_USER",
          parts: [{ text: "Please FIX THE LOGIN BUG today" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as CompletedResponse;
  assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(body.result.task.status.message.parts, [
    {
      mediaType: "text/markdown",
      metadata: {},
      text: "## ✅ Login bug fixed\n\nSession tokens now refresh before validation; the checkout suite passed.",
    },
  ]);
});

test("selects a scenario from a JSON-RPC Jira data part", async (t) => {
  const scenarios: LoadedScenario[] = [
    {
      id: "work-item",
      default: false,
      match: { contains: [], workItem: { id: "PROJ-42" } },
      steps: [
        {
          event: "status-update",
          state: "completed",
          message: "Matched the Jira work item.",
        },
      ],
    },
    {
      id: "default",
      default: true,
      match: { contains: [] },
      steps: [
        { event: "status-update", state: "completed", message: "Default." },
      ],
    },
  ];
  const { request, token } = await createFixture(t, { scenarios });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "jira-context",
      method: "SendMessage",
      params: {
        message: {
          contextId: "jira-context",
          messageId: "jira-message",
          role: "ROLE_USER",
          parts: [
            { text: "No matching text." },
            { data: { invocationContext: { workItem: { id: "PROJ-42" } } } },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as CompletedResponse;
  assert.match(
    JSON.stringify(body.result.task.status.message.parts),
    /Matched the Jira work item/,
  );
});

test("emits safe correlated diagnostics for a selected scenario", async (t) => {
  const diagnostics: DiagnosticEvent[] = [];
  const { request, token } = await createFixture(t, {
    diagnostics: (event: DiagnosticEvent) => diagnostics.push(event),
    scenarios: [
      {
        id: "work-item",
        default: false,
        match: { contains: [], workItem: { id: "PROJ-42" } },
        steps: [{ event: "status-update", state: "completed" }],
      },
      {
        id: "default",
        default: true,
        match: { contains: [] },
        steps: [{ event: "status-update", state: "completed" }],
      },
    ],
  });
  const secret = "forge-token-secret";
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "diagnostic-run",
      method: "SendMessage",
      params: {
        message: {
          contextId: "diagnostic-context",
          messageId: "diagnostic-message",
          role: "ROLE_USER",
          parts: [
            { text: "Ignore this unnecessary Jira content." },
            {
              data: {
                invocationContext: {
                  workItem: {
                    id: "PROJ-42",
                    fields: { summary: "Sensitive work-item summary" },
                  },
                  comment: { body: "Sensitive comment body" },
                  tenantId: "tenant-1",
                  invokerId: "user-1",
                  token: secret,
                },
              },
            },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const task = (await response.json()) as CompletedResponse;
  const output = JSON.stringify(diagnostics);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.event === "scenario-selected" &&
        event.taskId === task.result.task.id &&
        event.contextId === "diagnostic-context" &&
        event.scenarioId === "work-item" &&
        event.selection === "work-item" &&
        event.tenantId === "tenant-1" &&
        event.invokerId === "user-1" &&
        event.workItemAvailability === "available" &&
        event.commentAvailability === "available",
    ),
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.event === "lifecycle" &&
        event.taskId === task.result.task.id &&
        event.state === "completed",
    ),
  );
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("Sensitive work-item summary"), false);
  assert.equal(output.includes("Sensitive comment body"), false);
});

test("simulates a correlated Jira comment callback without mutating Jira", async (t) => {
  const diagnostics: DiagnosticEvent[] = [];
  const scenarios: LoadedScenario[] = [
    {
      id: "simulated-comment",
      default: true,
      match: { contains: [] },
      steps: [
        {
          event: "status-update",
          state: "working",
          message: "Preparing the Jira update.",
        },
        {
          event: "jira-callback",
          action: "comment",
          result: "simulated",
          message:
            "Simulated Jira comment update; no Jira comment was created.",
        } as unknown as LoadedScenario["steps"][number],
        {
          event: "status-update",
          state: "completed",
          message: "Finished the simulated callback.",
        },
      ],
    },
  ];
  const { request, token } = await createFixture(t, {
    diagnostics: (event) => diagnostics.push(event),
    scenarios,
  });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "simulated-comment",
      method: "SendStreamingMessage",
      params: {
        message: {
          contextId: "callback-context",
          messageId: "callback-message",
          role: "ROLE_USER",
          parts: [
            {
              data: {
                invocationContext: {
                  workItem: { id: "PROJ-42" },
                  tenantId: "tenant-1",
                  invokerId: "user-1",
                },
              },
            },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.match(
    await response.text(),
    /Simulated Jira comment update; no Jira comment was created/,
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.event === "jira-callback" &&
        event.action === "comment" &&
        event.result === "simulated" &&
        event.tenantId === "tenant-1" &&
        event.invokerId === "user-1" &&
        event.workItemId === "PROJ-42",
    ),
  );
});

test("reports every simulated Jira callback action with active invocation correlation", async (t) => {
  const diagnostics: DiagnosticEvent[] = [];
  const scenarios: LoadedScenario[] = [
    {
      id: "all-callbacks",
      default: true,
      match: { contains: [] },
      steps: [
        { event: "status-update", state: "working" },
        ...(["read", "comment", "mention", "transition"] as const).map(
          (action) => ({
            event: "jira-callback",
            action,
            result: "simulated" as const,
          }),
        ),
        { event: "status-update", state: "completed" },
      ],
    },
  ];
  const { request, token } = await createFixture(t, {
    diagnostics: (event) => diagnostics.push(event),
    scenarios,
  });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "all-callbacks",
      method: "SendStreamingMessage",
      params: {
        message: {
          contextId: "callbacks-context",
          messageId: "callbacks-message",
          role: "ROLE_USER",
          parts: [
            {
              data: {
                invocationContext: {
                  workItem: { id: "PROJ-42" },
                  tenantId: "tenant-1",
                  invokerId: "user-1",
                },
              },
            },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const stream = await response.text();
  for (const action of ["read", "comment", "mention", "transition"]) {
    assert.match(
      stream,
      new RegExp(`Simulated Jira ${action} callback \\(simulated\\)`),
    );
    assert.ok(
      diagnostics.some(
        (event) =>
          event.event === "jira-callback" &&
          event.action === action &&
          event.result === "simulated" &&
          event.tenantId === "tenant-1" &&
          event.invokerId === "user-1",
      ),
    );
  }
});

test("maps simulated callback outcomes and unavailable context to visible task results", async (t) => {
  const requestFor = async (
    t: TestContext,
    result: "auth-required" | "rejected" | "failed" | "simulated",
    context: Record<string, unknown>,
  ) => {
    const scenarios: LoadedScenario[] = [
      {
        id: `callback-${result}`,
        default: true,
        match: { contains: [] },
        steps: [
          { event: "status-update", state: "working" },
          { event: "jira-callback", action: "transition", result },
          { event: "status-update", state: "completed" },
        ],
      },
    ];
    const { request, token } = await createFixture(t, { scenarios });
    const response = await request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `callback-${result}`,
        method: "SendMessage",
        params: {
          message: {
            contextId: `callback-${result}-context`,
            messageId: `callback-${result}-message`,
            role: "ROLE_USER",
            parts: [{ data: { invocationContext: context } }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    return JSON.stringify(await response.json());
  };
  const context = {
    workItem: { id: "PROJ-42" },
    tenantId: "tenant-1",
    invokerId: "user-1",
  };

  assert.match(
    await requestFor(t, "auth-required", context),
    /TASK_STATE_AUTH_REQUIRED/,
  );
  assert.match(await requestFor(t, "rejected", context), /TASK_STATE_REJECTED/);
  assert.match(await requestFor(t, "failed", context), /TASK_STATE_FAILED/);
  assert.match(
    await requestFor(t, "simulated", {
      tenantId: "tenant-1",
      invokerId: "user-1",
    }),
    /active invocation context is unavailable; no Jira action was performed/,
  );
});

test("runs explicitly enabled Jira callback smoke actions with validated identity", async (t) => {
  const calls: { body?: unknown; method?: string; url: string }[] = [];
  const jiraFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (String(input).endsWith("/transitions"))
      return Response.json({ transitions: [{ id: "31" }] });
    return new Response(null, { status: 204 });
  };
  const scenarios: LoadedScenario[] = [
    {
      id: "real-smoke",
      default: true,
      match: { contains: [] },
      steps: [
        { event: "jira-callback", action: "read", real: true },
        { event: "jira-callback", action: "comment", real: true },
        {
          event: "jira-callback",
          action: "transition",
          real: true,
          transitionId: "31",
        },
        { event: "status-update", state: "completed" },
      ] as LoadedScenario["steps"],
    },
  ];
  const { request, token } = await createFixture(t, {
    enableRealJiraCallbacks: true,
    fitClaims: {
      app: { apiBaseUrl: "https://jira.example.test" },
      context: { cloudId: "ari:cloud:jira::site/tenant-from-fit" },
      sub: "user-from-fit",
    },
    jiraFetch,
    scenarios,
  });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "real-smoke",
      method: "SendMessage",
      params: {
        message: {
          contextId: "real-smoke-context",
          messageId: "real-smoke-message",
          role: "ROLE_USER",
          parts: [
            {
              data: {
                invocationContext: {
                  workItem: { id: "PROJ-42" },
                  tenantId: "untrusted-tenant",
                  invokerId: "untrusted-user",
                },
              },
            },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as CompletedResponse).result.task.status.state,
    "TASK_STATE_COMPLETED",
  );
  assert.deepEqual(
    calls.map(({ method, url }) => ({ method, url })),
    [
      {
        method: "GET",
        url: "https://jira.example.test/rest/api/3/issue/PROJ-42",
      },
      {
        method: "POST",
        url: "https://jira.example.test/rest/api/3/issue/PROJ-42/comment",
      },
      {
        method: "POST",
        url: "https://jira.example.test/rest/api/3/issue/PROJ-42/transitions",
      },
    ],
  );
  assert.match(JSON.stringify(calls[1]?.body), /user-from-fit/);
  assert.deepEqual(calls[2]?.body, { transition: { id: "31" } });
});

test("emits a terminal log when a Jira callback rejects a task", async (t) => {
  const records: RemoteLogRecord[] = [];
  const scenarios: LoadedScenario[] = [
    {
      id: "callback-rejected",
      default: true,
      match: { contains: [] },
      steps: [
        { event: "status-update", state: "working" },
        { event: "jira-callback", action: "transition", result: "rejected" },
      ],
    },
  ];
  const { request, token } = await createFixture(t, {
    remoteLogger: {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
      error: (record) => records.push(record),
    },
    scenarios,
  });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "callback-rejected",
      method: "SendMessage",
      params: {
        message: {
          contextId: "callback-rejected-context",
          messageId: "callback-rejected-message",
          role: "ROLE_USER",
          parts: [
            {
              data: {
                invocationContext: {
                  workItem: { id: "PROJ-42" },
                  tenantId: "tenant-1",
                  invokerId: "user-1",
                },
              },
            },
          ],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as CompletedResponse).result.task.status.state,
    "TASK_STATE_REJECTED",
  );
  assert.ok(
    records.some(
      (record) =>
        record.event === "remote.a2a.completed" &&
        record.a2a.state === "TASK_STATE_REJECTED" &&
        record.a2a.contextId === "callback-rejected-context",
    ),
  );
});

test("streams coding progress and chunked artifacts in declared order", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "coding-stream",
      method: "SendStreamingMessage",
      params: {
        message: {
          contextId: "coding-context",
          messageId: "coding-message",
          role: "ROLE_USER",
          parts: [{ text: "Please fix the login bug today" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const stream = await response.text();
  const events = [
    "Starting login-bug fix",
    "### Investigation",
    "Internal thinking",
    "### Change plan",
    "patch-1",
    "trailing whitespace cleanup",
    "### Verification",
    "42 tests passed",
    "implementation-summary-1",
    "## ✅ Login bug fixed",
  ];
  let previous = -1;
  for (const event of events) {
    const index = stream.indexOf(event);
    assert.ok(index > previous, `expected ${event} after the previous event`);
    previous = index;
  }
});

test("streams a Markdown showcase as ordered status updates", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "markdown-stream",
      method: "SendStreamingMessage",
      params: {
        message: {
          contextId: "markdown-context",
          messageId: "markdown-message",
          role: "ROLE_USER",
          parts: [{ text: "Please show markdown" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const stream = await response.text();
  let previous = -1;
  for (const content of [
    "Markdown showcase",
    "Bold text",
    "First list item",
    "First ordered step",
    "short blockquote",
    "session.refresh()",
    "const refreshed",
    "A2A protocol",
    "Showcase complete",
  ]) {
    const index = stream.indexOf(content);
    assert.ok(
      index > previous,
      `expected ${content} after the previous update`,
    );
    previous = index;
  }
  assert.match(stream, /text\/markdown/);
});

test("streams rejected and failed scenarios with their correct terminal outcomes", async (t) => {
  const { request, token } = await createFixture(t);
  const stream = async (id: string, text: string) => {
    const response = await request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "SendStreamingMessage",
        params: {
          message: {
            contextId: `${id}-context`,
            messageId: `${id}-message`,
            role: "ROLE_USER",
            parts: [{ text }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    return response.text();
  };

  const rejected = await stream("rejected", "reject immediately");
  assert.match(rejected, /TASK_STATE_REJECTED/);
  assert.equal(rejected.includes("TASK_STATE_WORKING"), false);

  const failed = await stream(
    "failed",
    "push the fix to the archived-reports repository",
  );
  const working = failed.indexOf("TASK_STATE_WORKING");
  const diagnostic = failed.indexOf("unapplied-patch-1");
  const terminal = failed.indexOf("TASK_STATE_FAILED");
  assert.ok(working >= 0 && diagnostic > working && terminal > diagnostic);
  assert.equal(
    failed.slice(terminal + 1).includes("TASK_STATE_WORKING"),
    false,
  );
});

test("returns a JSON-RPC error for a SendMessage request without a message", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "SendMessage",
      params: {},
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    error: { code: number };
    id: number;
    jsonrpc: string;
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 7);
  assert.equal(body.error.code, -32603);
});

test("rejects invalid requests and reports unsupported methods", async (t) => {
  const { request, token } = await createFixture(t);
  const validRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: "id",
    method: "SendMessage",
    params: { message: {} },
  });

  assert.equal((await request({ body: "not json" })).status, 401);
  assert.equal(
    (await request({ token: token(), body: validRequest, path: "/wrong" }))
      .status,
    404,
  );
  assert.equal(
    (
      await request({
        token: token(),
        body: validRequest,
        contentType: "text/plain",
      })
    ).status,
    400,
  );

  const malformed = await request({ token: token(), body: "not json" });
  assert.equal(malformed.status, 400);
  assert.equal(
    ((await malformed.json()) as { error: { code: number } }).error.code,
    -32700,
  );
  const unsupported = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "UnknownMethod",
      params: {},
    }),
  });
  assert.equal(unsupported.status, 200);
  assert.deepEqual(await unsupported.json(), {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32601, message: "Invalid method." },
  });
});

test("creates fresh task and message IDs without echoing caller data", async (t) => {
  const { request, token } = await createFixture(t);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: {
        contextId: "",
        messageId: "message-789",
        role: "ROLE_USER",
        parts: [{ data: { secret: "never return" } }],
      },
    },
  });
  const [first, second] = await Promise.all([
    request({ token: token(), body }).then(
      async (response) => (await response.json()) as CompletedResponse,
    ),
    request({ token: token(), body }).then(
      async (response) => (await response.json()) as CompletedResponse,
    ),
  ]);

  assert.notEqual(first.result.task.id, second.result.task.id);
  assert.notEqual(
    first.result.task.status.message.messageId,
    second.result.task.status.message.messageId,
  );
  assert.notEqual(first.result.task.contextId, second.result.task.contextId);
  assert.equal(
    JSON.stringify(first.result.task.status.message).includes("never return"),
    false,
  );
});

test("resumes a clarification pause on the same task", async (t) => {
  const { request, token } = await createFixture(t);
  const initial = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clarification-start",
      method: "SendMessage",
      params: {
        message: {
          contextId: "clarification-context",
          messageId: "clarification-start-message",
          role: "ROLE_USER",
          parts: [
            {
              text: "Clarify the acceptance criteria for the checkout redesign",
            },
          ],
        },
      },
    }),
  });

  assert.equal(initial.status, 200);
  const paused = (await initial.json()) as CompletedResponse;
  assert.equal(paused.result.task.status.state, "TASK_STATE_INPUT_REQUIRED");
  assert.match(
    JSON.stringify(paused.result.task.status.message.parts),
    /guest checkout/i,
  );
  assert.match(JSON.stringify(paused.result.task), /checkout-plan-1/);

  const resumed = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clarification-resume",
      method: "SendMessage",
      params: {
        message: {
          taskId: paused.result.task.id,
          contextId: paused.result.task.contextId,
          messageId: "clarification-resume-message",
          role: "ROLE_USER",
          parts: [{ text: "Guest checkout must be supported." }],
        },
      },
    }),
  });

  assert.equal(resumed.status, 200);
  const completed = (await resumed.json()) as CompletedResponse;
  assert.equal(completed.result.task.id, paused.result.task.id);
  assert.match(JSON.stringify(completed.result.task), /checkout-plan-1/);
  assert.equal(completed.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.match(
    JSON.stringify(completed.result.task.status.message.parts),
    /clarified acceptance criteria/i,
  );
});

test("resumes an authorization pause on the same task", async (t) => {
  const { request, token } = await createFixture(t);
  const send = (id: string, message: Record<string, unknown>) =>
    request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "SendMessage",
        params: { message },
      }),
    });
  const initial = await send("authorization-start", {
    contextId: "authorization-context",
    messageId: "authorization-start-message",
    role: "ROLE_USER",
    parts: [{ text: "Push the hotfix to the repository" }],
  });

  assert.equal(initial.status, 200);
  const paused = (await initial.json()) as CompletedResponse;
  assert.equal(paused.result.task.status.state, "TASK_STATE_AUTH_REQUIRED");
  assert.match(
    JSON.stringify(paused.result.task),
    /permission to push commits/i,
  );

  const resumed = await send("authorization-resume", {
    taskId: paused.result.task.id,
    contextId: paused.result.task.contextId,
    messageId: "authorization-resume-message",
    role: "ROLE_USER",
    parts: [{ text: "Approved." }],
  });

  assert.equal(resumed.status, 200);
  const completed = (await resumed.json()) as CompletedResponse;
  assert.equal(completed.result.task.id, paused.result.task.id);
  assert.equal(completed.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.match(
    JSON.stringify(completed.result.task),
    /release pipeline succeeded/i,
  );
});

test("pauses before work for initial clarification and authorization", async (t) => {
  const { request, token } = await createFixture(t);
  for (const [state, prompt] of [
    [
      "TASK_STATE_INPUT_REQUIRED",
      "Start only after confirming the target environment",
    ],
    [
      "TASK_STATE_AUTH_REQUIRED",
      "Start only after approving repository access",
    ],
  ]) {
    const initial = await request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${state}-start`,
        method: "SendMessage",
        params: {
          configuration: { returnImmediately: true },
          message: {
            contextId: `${state}-context`,
            messageId: `${state}-start-message`,
            role: "ROLE_USER",
            parts: [{ text: prompt }],
          },
        },
      }),
    });

    assert.equal(initial.status, 200);
    const paused = (await initial.json()) as CompletedResponse;
    assert.equal(paused.result.task.status.state, state);
    assert.equal(
      JSON.stringify(paused.result.task).includes("starting work"),
      false,
    );

    const resumed = await request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${state}-resume`,
        method: "SendMessage",
        params: {
          message: {
            taskId: paused.result.task.id,
            contextId: paused.result.task.contextId,
            messageId: `${state}-resume-message`,
            role: "ROLE_USER",
            parts: [{ text: "Continue." }],
          },
        },
      }),
    });

    assert.equal(resumed.status, 200);
    const completed = (await resumed.json()) as CompletedResponse;
    assert.equal(completed.result.task.id, paused.result.task.id);
    assert.equal(completed.result.task.status.state, "TASK_STATE_COMPLETED");
  }
});

test("reports delayed scenario progress through GetTask polling", async (t) => {
  const scenarios: LoadedScenario[] = [
    {
      id: "polling-progress",
      default: true,
      match: { contains: [] },
      steps: [
        {
          event: "status-update",
          state: "working",
          message: "Started polling scenario.",
        },
        {
          event: "status-update",
          message: "Reached the delayed update.",
          delayMs: 100,
        },
        {
          event: "status-update",
          state: "completed",
          message: "Finished polling scenario.",
          delayMs: 100,
        },
      ],
    },
  ];
  const { request, token } = await createFixture(t, { scenarios });
  const send = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "polling-start",
      method: "SendMessage",
      params: {
        configuration: { returnImmediately: true },
        message: {
          contextId: "polling-context",
          messageId: "polling-message",
          role: "ROLE_USER",
          parts: [{ text: "Run the polling scenario." }],
        },
      },
    }),
  });

  assert.equal(send.status, 200);
  const started = (await send.json()) as CompletedResponse;
  assert.equal(started.result.task.status.state, "TASK_STATE_WORKING");
  assert.match(
    JSON.stringify(started.result.task.status.message.parts),
    /Started polling scenario/,
  );

  const task = async () => {
    const response = await request({
      token: token(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "polling-get-task",
        method: "GetTask",
        params: { id: started.result.task.id },
      }),
    });
    assert.equal(response.status, 200);
    return (await response.json()) as {
      result: CompletedResponse["result"]["task"];
    };
  };

  await new Promise((resolve) => setTimeout(resolve, 130));
  const progressed = await task();
  assert.equal(progressed.result.status.state, "TASK_STATE_WORKING");
  assert.match(
    JSON.stringify(progressed.result.status.message.parts),
    /Reached the delayed update/,
  );

  await new Promise((resolve) => setTimeout(resolve, 130));
  const completed = await task();
  assert.equal(completed.result.status.state, "TASK_STATE_COMPLETED");
  assert.match(
    JSON.stringify(completed.result.status.message.parts),
    /Finished polling scenario/,
  );
});

test("cancels delayed work after retaining its earlier artifact", async (t) => {
  const { request, token } = await createFixture(t);
  const started = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cancel-start",
      method: "SendMessage",
      params: {
        configuration: { returnImmediately: true },
        message: {
          contextId: "cancel-context",
          messageId: "cancel-start-message",
          role: "ROLE_USER",
          parts: [{ text: "Start the long-running repository migration" }],
        },
      },
    }),
  });

  assert.equal(started.status, 200);
  const working = (await started.json()) as CompletedResponse;
  await new Promise((resolve) => setTimeout(resolve, 230));

  const canceled = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cancel-task",
      method: "CancelTask",
      params: { id: working.result.task.id },
    }),
  });

  assert.equal(canceled.status, 200);
  const canceledTask = (await canceled.json()) as {
    result: CompletedResponse["result"]["task"];
  };
  assert.equal(canceledTask.result.status.state, "TASK_STATE_CANCELED");
  assert.match(JSON.stringify(canceledTask.result), /migration-progress-1/);

  await new Promise((resolve) => setTimeout(resolve, 250));
  const fetched = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "get-canceled-task",
      method: "GetTask",
      params: { id: working.result.task.id },
    }),
  });
  assert.equal(fetched.status, 200);
  const task = (await fetched.json()) as {
    result: CompletedResponse["result"]["task"];
  };
  assert.equal(task.result.status.state, "TASK_STATE_CANCELED");
  assert.equal(
    JSON.stringify(task.result).includes("TASK_STATE_COMPLETED"),
    false,
  );
});
