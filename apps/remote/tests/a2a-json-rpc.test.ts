/**
 * A2A JSON-RPC remote-agent contract tests
 *
 * These tests complement the remote-agent docs by exercising the HTTP JSON-RPC
 * envelopes Jira sends to a remote agent backend and the Task response shapes
 * Jira expects when polling or canceling work.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/|Integrate remote agents with Jira}
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messageSendParams from "./data/message-send-params.json";

const validateAuthHeader = vi.fn();

vi.mock("forge-ahead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("forge-ahead")>();
  return {
    ...actual,
    validateAuthHeader,
  };
});

const { app } = await import("../src/server.js");
const { contexts, tasks } = await import("../src/storage.js");

const fitPayload = {
  context: {
    cloudId: "89a6b224-3b44-4cef-8e4d-37aff29af277",
    moduleKey: "jira-agent-connector",
    userAccess: {
      enabled: false,
      hasAccess: true,
    },
  },
};

async function postJsonRpc(
  body: unknown,
  options: { authorization?: string } = { authorization: "Bearer test-fit" },
): Promise<Response> {
  const { createServer } = await import("node:http");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start test server");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }

  try {
    return await fetch(`http://127.0.0.1:${address.port}/a2a/json-rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

/**
 * Post a streaming (SSE) JSON-RPC request and collect every parsed
 * `data: <json>` event until the response closes.
 */
async function postJsonRpcStreaming(body: unknown): Promise<unknown[]> {
  const { createServer } = await import("node:http");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start test server");
  }

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/a2a/json-rpc`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: "Bearer test-fit",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.body) {
      throw new Error("Streaming response had no body");
    }

    const events: unknown[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = rawEvent
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine) {
          events.push(JSON.parse(dataLine.slice("data: ".length)));
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    return events;
  } finally {
    server.close();
  }
}

describe("A2A JSON-RPC protocol contract", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts JSON-RPC 2.0 message/send and returns a Task result envelope", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-message-send",
      method: "message/send",
      params: messageSendParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: "req-message-send",
      result: {
        kind: "task",
        contextId: expect.any(String),
        status: {
          state: "working",
          message: {
            role: "agent",
            kind: "message",
            parts: [{ kind: "text", text: expect.any(String) }],
          },
          timestamp: expect.any(String),
        },
      },
    });
    expect(body.result.id).toMatch(/^task-/);
    expect(body.result.status.message.taskId).toBe(body.result.id);
    expect(body.result.status.message.contextId).toBe(body.result.contextId);
  });

  it("accepts JSON-RPC 2.0 tasks/get with the specified taskId parameter", async () => {
    const createdResponse = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-create",
      method: "message/send",
      params: messageSendParams,
    });
    const createdBody = await createdResponse.json();

    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-tasks-get",
      method: "tasks/get",
      params: { taskId: createdBody.result.id },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: "req-tasks-get",
      result: {
        id: createdBody.result.id,
        kind: "task",
        status: { state: "working" },
      },
    });
  });

  it("rejects legacy tasks/get params that use id instead of taskId", async () => {
    const createdResponse = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-create",
      method: "message/send",
      params: messageSendParams,
    });
    const createdBody = await createdResponse.json();

    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-legacy-get",
      method: "tasks/get",
      params: { id: createdBody.result.id, historyLength: 0 },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "req-legacy-get",
      error: { code: -32001, message: "Task not found" },
    });
  });

  it("accepts JSON-RPC 2.0 tasks/cancel with the specified taskId parameter", async () => {
    const createdResponse = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-create",
      method: "message/send",
      params: messageSendParams,
    });
    const createdBody = await createdResponse.json();

    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-cancel",
      method: "tasks/cancel",
      params: { taskId: createdBody.result.id },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "req-cancel",
      result: {
        id: createdBody.result.id,
        kind: "task",
        status: { state: "canceled" },
      },
    });
  });

  it("returns JSON-RPC Invalid Request for non-2.0 envelopes", async () => {
    const response = await postJsonRpc({
      jsonrpc: "1.0",
      id: "req-invalid",
      method: "message/send",
      params: messageSendParams,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-invalid",
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("returns JSON-RPC Method not found for unsupported methods", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-unknown",
      method: "tasks/pause",
      params: {},
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-unknown",
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("rejects requests without a Forge Invocation Token", async () => {
    const response = await postJsonRpc(
      {
        jsonrpc: "2.0",
        id: "req-no-auth",
        method: "message/send",
        params: messageSendParams,
      },
      { authorization: undefined },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Missing or invalid authorization header",
    });
    expect(validateAuthHeader).not.toHaveBeenCalled();
  });

  it("rejects requests when FIT verification fails", async () => {
    validateAuthHeader.mockResolvedValueOnce({
      isErr: () => true,
      error: {
        status: 401,
        title: "Unauthorized",
        detail: "invalid token",
      },
    });

    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-bad-fit",
      method: "message/send",
      params: messageSendParams,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      status: 401,
      title: "Unauthorized",
      detail: "invalid token",
    });
  });

  it("returns JSON-RPC Method not found when method is missing", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-missing-method",
      params: {},
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-missing-method",
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns a task-not-found JSON-RPC error when tasks/get omits taskId", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-get-missing-task-id",
      method: "tasks/get",
      params: {},
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-get-missing-task-id",
      error: { code: -32001, message: "Task not found" },
    });
  });

  it("returns a task-not-found JSON-RPC error when tasks/cancel omits taskId", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-cancel-missing-task-id",
      method: "tasks/cancel",
      params: {},
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-cancel-missing-task-id",
      error: { code: -32001, message: "Task not found" },
    });
  });

  it("returns a task-not-found JSON-RPC error for unknown task IDs", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-get-unknown-task",
      method: "tasks/get",
      params: { taskId: "task-does-not-exist" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "req-get-unknown-task",
      error: { code: -32001, message: "Task not found" },
    });
  });
});

describe("A2A JSON-RPC streaming message/send (Simulation Scenario driven)", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("begins streaming with the matched scenario's first step state and message", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream",
      method: "message/send",
      params: messageSendParams,
    });

    const first = events[0] as {
      result: {
        task: {
          status: {
            state: string;
            message: { parts: Array<{ text: string }> };
          };
        };
      };
    };

    expect(first.result.task.status.state).toBe("working");
    expect(first.result.task.status.message.parts[0].text).toContain(
      "Starting work on this task.",
    );
  });

  it("streams the remaining scenario steps in order, ending with a final event that closes the stream", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-order",
      method: "message/send",
      params: messageSendParams,
    });

    type StatusUpdateEnvelope = {
      result: {
        statusUpdate?: {
          status: { state: string; final?: undefined };
          message: { parts: Array<{ text: string }> };
          final: boolean;
        };
      };
    };
    const [, second, third] = events as StatusUpdateEnvelope[];

    expect(events).toHaveLength(3);

    expect(second.result.statusUpdate?.status.state).toBe("working");
    expect(second.result.statusUpdate?.final).toBe(false);
    expect(second.result.statusUpdate?.message.parts[0].text).toContain(
      "Looking into the details...",
    );

    expect(third.result.statusUpdate?.status.state).toBe("completed");
    expect(third.result.statusUpdate?.final).toBe(true);
    expect(third.result.statusUpdate?.message.parts[0].text).toContain(
      "Finished the task.",
    );
  });

  it("leaves polling/non-streaming message/send using submitted-then-working, unaffected by the scenario runner", async () => {
    const response = await postJsonRpc({
      jsonrpc: "2.0",
      id: "req-polling-unaffected",
      method: "message/send",
      params: messageSendParams,
    });

    const body = await response.json();

    expect(body.result.status.state).toBe("working");
  });

  it("begins streaming with an immediate terminal state when the matched scenario cannot start normally", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-reject",
      method: "message/send",
      params: {
        ...messageSendParams,
        message: {
          ...messageSendParams.message,
          parts: [
            {
              text: "Please reject immediately, this is out of scope.",
              kind: "text",
            },
          ],
        },
      },
    });

    const first = events[0] as {
      result: {
        task: {
          status: {
            state: string;
            message: { parts: Array<{ text: string }> };
          };
        };
      };
    };

    expect(events).toHaveLength(1);
    expect(first.result.task.status.state).toBe("rejected");
    expect(first.result.task.status.message.parts[0].text).toContain(
      "This request cannot be accepted.",
    );
  });
});

describe("A2A JSON-RPC coding-agent artifact streaming", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function codingAgentMessageSendParams(): typeof messageSendParams {
    return {
      ...messageSendParams,
      message: {
        ...messageSendParams.message,
        parts: [{ text: "Fix the login bug.", kind: "text" }],
      },
    };
  }

  type TaskEnvelope = { result: { task: { id: string; contextId: string } } };
  type ArtifactUpdateEnvelope = {
    result: {
      artifactUpdate?: {
        taskId: string;
        contextId: string;
        artifact: {
          artifactId: string;
          name?: string;
          description?: string;
          metadata?: { kind?: string };
        };
        append?: boolean;
        lastChunk?: boolean;
      };
    };
  };

  it("streams artifact-update events whose taskId and contextId match the streamed task", async () => {
    const events = (await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-artifacts",
      method: "message/send",
      params: codingAgentMessageSendParams(),
    })) as Array<TaskEnvelope | ArtifactUpdateEnvelope>;

    const task = (events[0] as TaskEnvelope).result.task;
    const artifactUpdates = events
      .map((event) => (event as ArtifactUpdateEnvelope).result.artifactUpdate)
      .filter((update): update is NonNullable<typeof update> =>
        Boolean(update),
      );

    expect(artifactUpdates.length).toBeGreaterThan(0);
    for (const update of artifactUpdates) {
      expect(update.taskId).toBe(task.id);
      expect(update.contextId).toBe(task.contextId);
    }
  });

  it("streams the implementation-summary artifact with display text and kind metadata before the final completed status update", async () => {
    const events = (await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-summary-artifact",
      method: "message/send",
      params: codingAgentMessageSendParams(),
    })) as Array<
      | ArtifactUpdateEnvelope
      | {
          result: {
            statusUpdate?: { status: { state: string }; final: boolean };
          };
        }
    >;

    const summaryIndex = events.findIndex(
      (event) =>
        (event as ArtifactUpdateEnvelope).result.artifactUpdate?.artifact
          .metadata?.kind === "implementation-summary",
    );
    const completedIndex = events.findIndex(
      (event) =>
        (
          event as {
            result: {
              statusUpdate?: { status: { state: string }; final: boolean };
            };
          }
        ).result.statusUpdate?.status.state === "completed",
    );

    const summaryUpdate = (events[summaryIndex] as ArtifactUpdateEnvelope)
      .result.artifactUpdate;
    expect(summaryUpdate?.artifact.name).toBeTruthy();
    expect(summaryUpdate?.artifact.description).toBeTruthy();
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeLessThan(completedIndex);
  });

  it("streams a chunked patch artifact's append and lastChunk fields over the wire", async () => {
    const events = (await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-chunked-artifact",
      method: "message/send",
      params: codingAgentMessageSendParams(),
    })) as ArtifactUpdateEnvelope[];

    const patchChunks = events
      .map((event) => event.result.artifactUpdate)
      .filter(
        (update): update is NonNullable<typeof update> =>
          update?.artifact.artifactId === "patch-1",
      );

    expect(patchChunks).toHaveLength(2);
    expect(patchChunks[0].lastChunk).toBeFalsy();
    expect(patchChunks[1].append).toBe(true);
    expect(patchChunks[1].lastChunk).toBe(true);
  });
});

describe("A2A JSON-RPC auth-required approval pause and resumption", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function hotfixMessageSendParams(): typeof messageSendParams {
    return {
      ...messageSendParams,
      message: {
        ...messageSendParams.message,
        parts: [{ text: "Push the hotfix to the repository.", kind: "text" }],
      },
    };
  }

  it("pauses the stream at auth-required with a labeled Approval Request and does not continue on its own", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-auth-required",
      method: "message/send",
      params: hotfixMessageSendParams(),
    });

    type StatusUpdateEnvelope = {
      result: {
        statusUpdate?: {
          status: { state: string };
          message: { parts: Array<{ text: string }> };
          final: boolean;
        };
      };
    };
    const last = events[events.length - 1] as StatusUpdateEnvelope;

    expect(last.result.statusUpdate?.status.state).toBe("auth-required");
    expect(last.result.statusUpdate?.final).toBe(false);
    expect(last.result.statusUpdate?.message.parts[0].text).toContain(
      "Approval required:",
    );
  });

  it("resumes the same task to working before further content when the user sends any follow-up input", async () => {
    const pausedEvents = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-auth-required",
      method: "message/send",
      params: hotfixMessageSendParams(),
    });
    const pausedTask = (
      pausedEvents[0] as { result: { task: { id: string; contextId: string } } }
    ).result.task;

    const resumedEvents = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-resume",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ text: "Approved, go ahead.", kind: "text" }],
          messageId: "resume-msg-1",
          taskId: pausedTask.id,
          contextId: pausedTask.contextId,
          kind: "message",
        },
      },
    });

    type TaskEnvelope = {
      result: { task: { id: string; status: { state: string } } };
    };
    type StatusUpdateEnvelope = {
      result: {
        statusUpdate?: { message: { parts: Array<{ text: string }> } };
      };
    };
    const [first, second] = resumedEvents as [
      TaskEnvelope,
      StatusUpdateEnvelope,
    ];

    expect(first.result.task.id).toBe(pausedTask.id);
    expect(first.result.task.status.state).toBe("working");
    expect(second.result.statusUpdate?.message.parts[0].text).toContain(
      "Pushing the hotfix commit",
    );
  });

  it("keeps the same task identity and connects the prior message history across the pause and resumption", async () => {
    await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-auth-required",
      method: "message/send",
      params: hotfixMessageSendParams(),
    });
    const [pausedTaskId, pausedTask] = [...tasks.entries()][0];
    const contextId = pausedTask.contextId;

    await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-resume",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ text: "Approved, go ahead.", kind: "text" }],
          messageId: "resume-msg-1",
          taskId: pausedTaskId,
          contextId,
          kind: "message",
        },
      },
    });

    expect(tasks.size).toBe(1);
    expect(tasks.has(pausedTaskId)).toBe(true);

    const context = contexts.get(contextId);
    const messageTexts = context?.messages.map((m) => m.text) ?? [];
    expect(
      messageTexts.some((text) => text.includes("Approval required:")),
    ).toBe(true);
    expect(messageTexts).toContain("Approved, go ahead.");
    expect(
      messageTexts.some((text) => text.includes("Pushed the hotfix")),
    ).toBe(true);
  });
});

describe("A2A JSON-RPC input-required clarification pause and resumption", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function checkoutMessageSendParams(): typeof messageSendParams {
    return {
      ...messageSendParams,
      message: {
        ...messageSendParams.message,
        parts: [
          {
            text: "Clarify the acceptance criteria for the checkout redesign.",
            kind: "text",
          },
        ],
      },
    };
  }

  it("pauses the stream at input-required with a labeled Input Need and does not continue on its own", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-input-required",
      method: "message/send",
      params: checkoutMessageSendParams(),
    });

    type StatusUpdateEnvelope = {
      result: {
        statusUpdate?: {
          status: { state: string };
          message: { parts: Array<{ text: string }> };
          final: boolean;
        };
      };
    };
    const last = events[events.length - 1] as StatusUpdateEnvelope;

    expect(last.result.statusUpdate?.status.state).toBe("input-required");
    expect(last.result.statusUpdate?.final).toBe(false);
    expect(last.result.statusUpdate?.message.parts[0].text).toContain(
      "Input required:",
    );
  });

  it("resumes the same task to working before further content when the user sends any follow-up input", async () => {
    const pausedEvents = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-input-required",
      method: "message/send",
      params: checkoutMessageSendParams(),
    });
    const pausedTask = (
      pausedEvents[0] as { result: { task: { id: string; contextId: string } } }
    ).result.task;

    const resumedEvents = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-resume",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ text: "Guest checkout must be supported.", kind: "text" }],
          messageId: "resume-msg-1",
          taskId: pausedTask.id,
          contextId: pausedTask.contextId,
          kind: "message",
        },
      },
    });

    type TaskEnvelope = {
      result: { task: { id: string; status: { state: string } } };
    };
    type StatusUpdateEnvelope = {
      result: {
        statusUpdate?: { message: { parts: Array<{ text: string }> } };
      };
    };
    const [first, second] = resumedEvents as [
      TaskEnvelope,
      StatusUpdateEnvelope,
    ];

    expect(first.result.task.id).toBe(pausedTask.id);
    expect(first.result.task.status.state).toBe("working");
    expect(second.result.statusUpdate?.message.parts[0].text).toContain(
      "Updating the checkout flow",
    );
  });

  it("keeps the same task identity and connects the prior message history across the pause and resumption", async () => {
    await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-input-required",
      method: "message/send",
      params: checkoutMessageSendParams(),
    });
    const [pausedTaskId, pausedTask] = [...tasks.entries()][0];
    const contextId = pausedTask.contextId;

    await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-resume",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ text: "Guest checkout must be supported.", kind: "text" }],
          messageId: "resume-msg-1",
          taskId: pausedTaskId,
          contextId,
          kind: "message",
        },
      },
    });

    expect(tasks.size).toBe(1);
    expect(tasks.has(pausedTaskId)).toBe(true);

    const context = contexts.get(contextId);
    const messageTexts = context?.messages.map((m) => m.text) ?? [];
    expect(messageTexts.some((text) => text.includes("Input required:"))).toBe(
      true,
    );
    expect(messageTexts).toContain("Guest checkout must be supported.");
    expect(
      messageTexts.some((text) => text.includes("Updated the checkout flow")),
    ).toBe(true);
  });
});

describe("A2A JSON-RPC terminal outcome semantics", () => {
  beforeEach(() => {
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: fitPayload,
    });
    tasks.clear();
    contexts.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type StatusUpdateEnvelope = {
    result: {
      statusUpdate?: {
        status: { state: string };
        message?: { parts: Array<{ text: string }> };
        final: boolean;
      };
    };
  };
  type ArtifactUpdateEnvelope = {
    result: {
      artifactUpdate?: {
        artifact: { metadata?: { kind?: string } };
      };
    };
  };

  it("ends the stream with a failed terminal state and a diagnostic Artifact when the matched scenario models unrecoverable repository access loss after acceptance", async () => {
    const events = (await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-failed",
      method: "message/send",
      params: {
        ...messageSendParams,
        message: {
          ...messageSendParams.message,
          parts: [
            {
              text: "Push the fix to the archived-reports repository.",
              kind: "text",
            },
          ],
        },
      },
    })) as Array<StatusUpdateEnvelope | ArtifactUpdateEnvelope>;

    const failedIndex = events.findIndex(
      (event) =>
        (event as StatusUpdateEnvelope).result.statusUpdate?.status.state ===
        "failed",
    );
    const diagnosticArtifactIndex = events.findIndex(
      (event) =>
        (event as ArtifactUpdateEnvelope).result.artifactUpdate?.artifact
          .metadata?.kind === "patch",
    );
    const last = events[events.length - 1] as StatusUpdateEnvelope;

    expect(failedIndex).toBeGreaterThanOrEqual(0);
    expect(diagnosticArtifactIndex).toBeGreaterThanOrEqual(0);
    expect(diagnosticArtifactIndex).toBeLessThan(failedIndex);
    expect(last.result.statusUpdate?.status.state).toBe("failed");
    expect(last.result.statusUpdate?.final).toBe(true);
  });

  it("begins streaming with an immediate rejected terminal state when the matched scenario models unrecoverable missing repository access before acceptance", async () => {
    const events = await postJsonRpcStreaming({
      jsonrpc: "2.0",
      id: "req-stream-repo-access-rejected",
      method: "message/send",
      params: {
        ...messageSendParams,
        message: {
          ...messageSendParams.message,
          parts: [
            {
              text: "Update the deleted legacy-reports repository.",
              kind: "text",
            },
          ],
        },
      },
    });

    const first = events[0] as {
      result: {
        task: {
          status: {
            state: string;
            message: { parts: Array<{ text: string }> };
          };
        };
      };
    };

    expect(events).toHaveLength(1);
    expect(first.result.task.status.state).toBe("rejected");
    expect(first.result.task.status.message.parts[0].text).toContain(
      "repository",
    );
  });
});
