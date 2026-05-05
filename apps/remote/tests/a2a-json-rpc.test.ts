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
