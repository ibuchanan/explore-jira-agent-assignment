/**
 * A2A JSON-RPC handler for Remote Agent task management
 *
 * Implements the Agent2Agent protocol methods:
 * - message/send: Handle new task assignments and follow-up messages
 * - tasks/get: Fetch task status updates
 * - tasks/cancel: Handle task cancellation
 *
 * This resolver acts as middleware, forwarding JSON-RPC calls to the
 * remote agent service and handling responses.
 *
 * @see {@link https://a2a.dev|Agent2Agent Protocol}
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/#rovo-agent-connector|agentConnector module}
 */

import { invokeRemote } from "@forge/api";
import {
  type CancelTaskParams,
  createErrorResponse,
  createSuccessResponse,
  type GetTaskParams,
  type JsonRpcRequest,
  type JsonRpcResponse,
  ok,
  type ProblemDetails,
  type Result,
  type SendMessageParams,
  StandardError,
  type Task,
  validateAuthHeader,
  validateJsonRpcRequest,
} from "forge-ahead";

// Maps HTTP status codes (from ProblemDetails) to JSON-RPC 2.0 error codes and messages.
// JSON-RPC and HTTP are independent error systems — this table is the single place
// where the translation lives, so callers use structured status codes, not string matching.
const HTTP_TO_JSONRPC: Record<number, { code: number; message: string }> = {
  404: { code: -32001, message: "Task not found" },
  409: { code: -32002, message: "Task not cancellable" },
};
const DEFAULT_JSONRPC_ERROR = { code: -32603, message: "Internal error" };

type ForwardContext = { systemToken?: string; userToken?: string };

/**
 * Build the Authorization headers for a forwarded request.
 * Adds Forge OAuth tokens when present so the remote service can
 * act on behalf of the user or app that triggered the call.
 */
function buildForwardHeaders(context: ForwardContext): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (context.systemToken)
    headers["x-forge-oauth-system"] = context.systemToken;
  if (context.userToken) headers["x-forge-oauth-user"] = context.userToken;
  return headers;
}

/**
 * Forward a JSON-RPC method call to the remote backend service and
 * return the task from the response, or a structured error Result.
 *
 * Handles the common plumbing shared by all three A2A method handlers:
 * builds and serialises the JSON-RPC request envelope, attaches auth headers,
 * checks HTTP-level and JSON-RPC-level errors, and returns ok(task) on success.
 */
async function invokeBackend(
  method: string,
  params: Record<string, unknown>,
  context: ForwardContext,
): Promise<Result<Task, ProblemDetails>> {
  const jsonRpcRequest = {
    jsonrpc: "2.0",
    id: `forge-${Date.now()}`,
    method,
    params,
  };
  console.log("Forwarding to remote service:", { method });

  const response = await invokeRemote("backend-service", {
    path: "/a2a/json-rpc",
    method: "POST",
    headers: buildForwardHeaders(context),
    body: JSON.stringify(jsonRpcRequest),
  });

  if (!response.ok) {
    return StandardError.getOrDefault(response.status).error(
      `Remote service error: ${response.status} ${response.statusText}`,
    );
  }

  const result = (await response.json()) as JsonRpcResponse;
  if (result.error) {
    // Map JSON-RPC error code → HTTP status so StandardError can look it up
    const status =
      result.error.code === -32001
        ? 404
        : result.error.code === -32002
          ? 409
          : 500;
    return StandardError.getOrDefault(status).error(result.error.message);
  }

  return ok(result.result as Task);
}

/**
 * Handles message/send method
 * Called when a user creates a new context or sends a follow-up message
 */
async function handleSendMessage(
  params: SendMessageParams,
  context: ForwardContext,
): Promise<Result<Task, ProblemDetails>> {
  const { message } = params;
  console.log("SendMessage called:", {
    messageId: message.messageId,
    contextId: message.contextId,
    hasContextId: !!message.contextId,
  });
  const result = await invokeBackend(
    "message/send",
    params as unknown as Record<string, unknown>,
    context,
  );
  if (result.isOk()) {
    console.log("Task created:", {
      taskId: result.value.id,
      contextId: result.value.contextId,
    });
  }
  return result;
}

/**
 * Handles tasks/get method
 * Called by Jira to poll for task status updates
 */
async function handleGetTask(
  params: GetTaskParams,
  context: ForwardContext,
): Promise<Result<Task, ProblemDetails>> {
  const { taskId } = params;
  console.log("GetTask called:", { taskId });
  const result = await invokeBackend("tasks/get", { taskId }, context);
  if (result.isOk()) {
    console.log("Task status:", {
      taskId: result.value.id,
      state: result.value.status.state,
    });
  }
  return result;
}

/**
 * Handles tasks/cancel method
 * Called when a user requests task cancellation
 */
async function handleCancelTask(
  params: CancelTaskParams,
  context: ForwardContext,
): Promise<Result<Task, ProblemDetails>> {
  const { taskId } = params;
  console.log("CancelTask called:", { taskId });
  const result = await invokeBackend("tasks/cancel", { taskId }, context);
  if (result.isOk()) {
    console.log("Task canceled:", { taskId: result.value.id });
  }
  return result;
}

/**
 * Resolve a Result<Task> into a JSON-RPC response object.
 * On success returns the task; on error maps the ProblemDetails status to a
 * JSON-RPC error code using the provided lookup table (falls back to -32603).
 */
function toJsonRpcResponse(
  id: JsonRpcRequest["id"],
  result: Result<Task, ProblemDetails>,
  errorMap: Record<number, { code: number; message: string }> = {},
  logLabel?: string,
): JsonRpcResponse {
  if (result.isOk()) {
    return createSuccessResponse(id, result.value);
  }
  if (logLabel) console.error(`${logLabel} error:`, result.error);
  const { code, message } =
    errorMap[result.error.status] ?? DEFAULT_JSONRPC_ERROR;
  return createErrorResponse(id, code, message, { detail: result.error.detail });
}

/**
 * Validate params and dispatch a single JSON-RPC method to its handler.
 * Returns a JsonRpcResponse (success or structured error) for every case.
 */
async function dispatchMethod(
  req: JsonRpcRequest,
  fwd: ForwardContext,
): Promise<JsonRpcResponse> {
  const { id, method } = req;

  switch (method) {
    case "message/send": {
      const params = req.params as unknown as SendMessageParams;
      if (
        !params?.message ||
        !Array.isArray(params.message.parts) ||
        params.message.parts.length === 0
      ) {
        return createErrorResponse(
          id,
          -32602,
          "Invalid params: message with non-empty parts is required",
        );
      }
      return toJsonRpcResponse(
        id,
        await handleSendMessage(params, fwd),
        {},
        "SendMessage",
      );
    }

    case "tasks/get": {
      const params = req.params as unknown as GetTaskParams;
      const taskId = params?.id ?? params?.taskId;
      if (!taskId || typeof taskId !== "string") {
        return createErrorResponse(id, -32602, "Invalid params: taskId is required");
      }
      return toJsonRpcResponse(
        id,
        await handleGetTask({ ...params, taskId }, fwd),
        HTTP_TO_JSONRPC,
        "GetTask",
      );
    }

    case "tasks/cancel": {
      const params = req.params as unknown as CancelTaskParams;
      const taskId = params?.id ?? params?.taskId;
      if (!taskId || typeof taskId !== "string") {
        return createErrorResponse(id, -32602, "Invalid params: taskId is required");
      }
      return toJsonRpcResponse(
        id,
        await handleCancelTask({ ...params, taskId }, fwd),
        HTTP_TO_JSONRPC,
        "CancelTask",
      );
    }

    default:
      return createErrorResponse(id, -32601, "Method not found");
  }
}

/**
 * Main JSON-RPC handler
 * Parses and validates the request, then delegates to dispatchMethod.
 *
 * @param request - Incoming HTTP request with JSON-RPC payload
 * @param context - Forge invocation context with auth tokens
 * @returns HTTP Response containing a JSON-RPC 2.0 envelope
 */
export async function handleJsonRpc(
  request: Request,
  context?: { headers?: Record<string, string> },
): Promise<Response> {
  try {
    const systemToken = context?.headers?.["x-forge-oauth-system"];
    const userToken = context?.headers?.["x-forge-oauth-user"];

    // Validate Forge Invocation Token when present
    if (context?.headers?.authorization) {
      const result = await validateAuthHeader(context.headers.authorization);
      if (result.isErr()) {
        console.error("Token validation failed:", result.error);
        return new Response(JSON.stringify(result.error), {
          status: result.error.status,
          headers: { "Content-Type": "application/problem+json" },
        });
      }
      console.debug("Token validated successfully for app:", result.value.aud);
    }

    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonRpcErrorResponse(400, -32700, "Parse error");
    }

    // Validate JSON-RPC envelope
    if (!validateJsonRpcRequest(body)) {
      return jsonRpcErrorResponse(400, -32600, "Invalid Request");
    }

    const jsonRpcRequest = body as JsonRpcRequest;
    const response = await dispatchMethod(jsonRpcRequest, { systemToken, userToken });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error in handleJsonRpc:", error);
    return jsonRpcErrorResponse(500, -32603, "Internal error");
  }
}

/** Build a plain HTTP Response wrapping a JSON-RPC error envelope. */
function jsonRpcErrorResponse(
  status: number,
  code: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
