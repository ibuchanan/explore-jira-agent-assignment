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
 * Main JSON-RPC handler
 * Routes requests to appropriate method handlers
 *
 * @param request - Incoming HTTP request with JSON-RPC payload
 * @param context - Forge invocation context with auth tokens
 * @returns JSON-RPC response
 */
export async function handleJsonRpc(
  request: Request,
  context?: {
    headers?: Record<string, string>;
  },
): Promise<Response> {
  try {
    // Extract tokens from headers if provided
    const systemToken = context?.headers?.["x-forge-oauth-system"];
    const userToken = context?.headers?.["x-forge-oauth-user"];

    // Validate FIT if present
    if (context?.headers?.authorization) {
      const result = await validateAuthHeader(context.headers.authorization);
      if (result.isErr()) {
        console.error("Token validation failed:", result.error);
        return new Response(JSON.stringify(result.error), {
          status: result.error.status,
          headers: { "Content-Type": "application/problem+json" },
        });
      }
      // Token is valid, payload available at result.value if needed
      console.debug("Token validated successfully for app:", result.value.aud);
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate JSON-RPC structure
    if (!validateJsonRpcRequest(body)) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const jsonRpcRequest = body as JsonRpcRequest;
    let response: JsonRpcResponse;

    // Route to appropriate handler
    switch (jsonRpcRequest.method) {
      case "message/send": {
        const params = jsonRpcRequest.params as unknown as SendMessageParams;
        const result = await handleSendMessage(params, {
          systemToken,
          userToken,
        });
        if (result.isOk()) {
          response = createSuccessResponse(jsonRpcRequest.id, result.value);
        } else {
          console.error("SendMessage error:", result.error);
          const { code, message } = DEFAULT_JSONRPC_ERROR;
          response = createErrorResponse(jsonRpcRequest.id, code, message, {
            detail: result.error.detail,
          });
        }
        break;
      }

      case "tasks/get": {
        const params = jsonRpcRequest.params as unknown as GetTaskParams;
        const result = await handleGetTask(params, { systemToken, userToken });
        if (result.isOk()) {
          response = createSuccessResponse(jsonRpcRequest.id, result.value);
        } else {
          console.error("GetTask error:", result.error);
          const { code, message } =
            HTTP_TO_JSONRPC[result.error.status] ?? DEFAULT_JSONRPC_ERROR;
          response = createErrorResponse(jsonRpcRequest.id, code, message, {
            detail: result.error.detail,
          });
        }
        break;
      }

      case "tasks/cancel": {
        const params = jsonRpcRequest.params as unknown as CancelTaskParams;
        const result = await handleCancelTask(params, {
          systemToken,
          userToken,
        });
        if (result.isOk()) {
          response = createSuccessResponse(jsonRpcRequest.id, result.value);
        } else {
          console.error("CancelTask error:", result.error);
          const { code, message } =
            HTTP_TO_JSONRPC[result.error.status] ?? DEFAULT_JSONRPC_ERROR;
          response = createErrorResponse(jsonRpcRequest.id, code, message, {
            detail: result.error.detail,
          });
        }
        break;
      }

      default:
        response = createErrorResponse(
          jsonRpcRequest.id,
          -32601,
          "Method not found",
        );
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error in handleJsonRpc:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
