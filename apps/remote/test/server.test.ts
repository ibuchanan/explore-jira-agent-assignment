import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";

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
    scenarios,
  }: { appAri?: string; appId?: string; scenarios?: LoadedScenario[] } = {},
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
    jwksUrl,
    ...(scenarios ? { scenarios } : {}),
  });
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
    { mediaType: "text/plain", metadata: {}, text: "Finished the task." },
  ]);
  assert.equal(body.result.task.status.message.role, "ROLE_AGENT");
  assert.equal(body.result.task.status.message.taskId, body.result.task.id);
  assert.equal(body.result.task.status.message.contextId, "context-456");
  assert.match(body.result.task.status.message.messageId, /^[0-9a-f-]{36}$/i);
  assert.match(body.result.task.status.timestamp, /^\d{4}-\d{2}-\d{2}T/);
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
    { mediaType: "text/plain", metadata: {}, text: "Finished the task." },
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
      mediaType: "text/plain",
      metadata: {},
      text: "Fixed the login bug and verified tests pass.",
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
    "Starting work on the login bug.",
    "Inspecting the repository",
    "Internal thinking:",
    "Drafting a code change",
    "patch-1",
    "trailing whitespace cleanup",
    "Tool: running the checkout test suite",
    "Tool result: all 42 tests passed.",
    "implementation-summary-1",
    "Fixed the login bug and verified tests pass.",
  ];
  let previous = -1;
  for (const event of events) {
    const index = stream.indexOf(event);
    assert.ok(index > previous, `expected ${event} after the previous event`);
    previous = index;
  }
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
