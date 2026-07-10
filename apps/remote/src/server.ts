/**
 * Remote Agent Backend Service
 *
 * This service integrates with the Forge app to handle Jira Remote Agent tasks.
 * It implements the Agent2Agent (A2A) JSON-RPC protocol for task management.
 */

import express from "express";
import {
  extractCloudId,
  formatAgentConnectorTaskResponse,
  isValidTransition,
  type TaskState,
} from "forge-ahead";
import { type AuthenticatedRequest, authMiddleware } from "./auth.js";
import {
  type AgentContext,
  contexts,
  installations,
  type JiraInstallation,
  loadData,
  saveData,
  type Task,
  tasks,
} from "./storage.js";

// ---------------------------------------------------------------------------
// Local streaming types
// These match the shapes exported from forge-ahead but are defined here so
// the remote app compiles independently without requiring a package build step.
// ---------------------------------------------------------------------------

interface StreamingMessage {
  role: "user" | "agent";
  parts: Array<{ kind: "text" | "data"; text?: string; data?: unknown }>;
  messageId: string;
  taskId?: string;
  contextId?: string;
  kind: "message";
}

interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: { state: TaskState; timestamp?: string };
  message?: StreamingMessage;
  kind: "status-update";
  final: boolean;
}

interface StreamArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Array<{ kind: "text" | "data"; text?: string; data?: unknown }>;
  metadata?: Record<string, unknown>;
}

interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: StreamArtifact;
  append?: boolean;
  lastChunk?: boolean;
  kind: "artifact-update";
}

interface StreamResponse {
  task?: unknown;
  statusUpdate?: TaskStatusUpdateEvent;
  message?: StreamingMessage;
  artifactUpdate?: TaskArtifactUpdateEvent;
}

export const app = express();
app.use(express.json());

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000;

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Prefix agent messages with robot emoji to make it obvious they come from the automated system
 */
function prefixAgentMessage(message: string): string {
  return `🤖 ${message}`;
}

// ============================================================================
// Message Context Helpers
// ============================================================================

/**
 * The parsed fields extracted from an incoming A2A message.
 */
interface MessageContext {
  contextId: string;
  workItemId: string | undefined;
  userAccountId: string | undefined;
  context: AgentContext;
}

/**
 * Parse an incoming A2A message payload, resolve (or create) the associated
 * AgentContext, and record the user's text parts in the context history.
 *
 * This logic is shared between the polling handler (handleMessageSend) and
 * the streaming handler (handleSendStreamingMessage) — extracting it here
 * eliminates the duplication between those two functions.
 *
 * @throws {Error} if the context cannot be found after creation (should never happen)
 */
/**
 * Scan a message's parts for the first data part and extract work item / user
 * identity fields from it. Returns undefined for any field not present.
 */
function extractDataFields(parts: unknown[]): {
  workItemId: string | undefined;
  userAccountId: string | undefined;
} {
  for (const part of parts) {
    if (
      (part as { kind: string }).kind === "data" &&
      (part as { data?: unknown }).data
    ) {
      const data = (part as { data: Record<string, unknown> }).data;
      return {
        // Accept nested `issue.id`, flat `issueId`, or flat `workItemId`
        workItemId:
          (data.issue as { id?: string })?.id ||
          (data.issueId as string) ||
          (data.workItemId as string),
        userAccountId: data.userAccountId as string,
      };
    }
  }
  return { workItemId: undefined, userAccountId: undefined };
}

/**
 * Append each text part in `parts` to `context.messages` as a user turn.
 */
function recordUserMessages(parts: unknown[], context: AgentContext): void {
  for (const part of parts) {
    if (
      (part as { kind: string }).kind === "text" &&
      (part as { text?: string }).text
    ) {
      context.messages.push({
        role: "user",
        text: (part as { text: string }).text,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

function resolveMessageContext(
  rawMessage: { contextId?: string; parts: unknown[] },
  cloudId: string | undefined,
): MessageContext {
  const contextId = rawMessage.contextId || generateId("ctx");
  const { workItemId, userAccountId } = extractDataFields(rawMessage.parts);

  // Create context if this is a new conversation
  if (!contexts.has(contextId)) {
    contexts.set(contextId, {
      id: contextId,
      userAccountId: userAccountId || "unknown",
      workItemId,
      cloudId: cloudId || "unknown",
      createdAt: new Date().toISOString(),
      messages: [],
    });
  }

  const context = contexts.get(contextId);
  if (!context) {
    throw new Error("Context not found");
  }

  recordUserMessages(rawMessage.parts, context);

  return { contextId, workItemId, userAccountId, context };
}

// ============================================================================
// JSON-RPC Method Definitions
// ============================================================================

const JSON_RPC_METHODS = {
  MESSAGE_SEND: "message/send",
  TASKS_GET: "tasks/get",
  TASKS_CANCEL: "tasks/cancel",
  TASKS_RESUBSCRIBE: "tasks/resubscribe",
} as const;

type JsonRpcMethod = (typeof JSON_RPC_METHODS)[keyof typeof JSON_RPC_METHODS];

interface JsonRpcHandlerParams {
  params: Record<string, unknown>;
  id: string;
  cloudId: string | undefined;
}

type JsonRpcHandler = (args: JsonRpcHandlerParams) => Promise<unknown>;

// ============================================================================
// JSON-RPC Method Handlers
// ============================================================================

/**
 * Handle message/send - creates a new task and context for the agent
 */
async function handleMessageSend({
  params,
  cloudId,
}: JsonRpcHandlerParams): Promise<unknown> {
  const { message } = params as {
    message: { contextId?: string; parts: unknown[] };
  };
  const taskId = generateId("task");

  const { contextId, workItemId, userAccountId, context } =
    resolveMessageContext(message, cloudId);

  // Create initial task in submitted state
  const baseInitialMessage = workItemId
    ? `Got it! I'm starting to work on this task for work item ${workItemId}.`
    : "Got it! I'm starting to work on this task.";
  const initialMessage = prefixAgentMessage(baseInitialMessage);

  const messageId = generateId("msg");
  const now = new Date().toISOString();

  const task: Task = {
    id: taskId,
    contextId,
    status: {
      state: "submitted",
      message: {
        role: "agent",
        parts: [
          {
            kind: "text",
            text: initialMessage,
          },
        ],
        messageId,
        taskId,
        contextId,
        kind: "message",
      },
      timestamp: now,
    },
    kind: "task",
    userAccountId,
    workItemId,
  };

  // Add agent message to context
  context.messages.push({
    role: "agent",
    text: initialMessage,
    timestamp: task.status.timestamp,
  });

  console.log("Task created:", { taskId, contextId, workItemId });

  // Save task to file persistence
  tasks.set(taskId, task);
  saveData();

  // Immediately transition to 'working' state
  transitionTaskToWorking(taskId, context);

  // Return the updated task object in response
  const updatedTask = tasks.get(taskId);
  if (!updatedTask) {
    throw new Error("Task not found after creation");
  }

  const formattedTask = formatAgentConnectorTaskResponse(
    updatedTask,
    contextId,
  );
  return formattedTask;
}

/**
 * Handle tasks/get - retrieves current task status
 */
async function handleTasksGet({
  params,
}: JsonRpcHandlerParams): Promise<unknown> {
  const taskId = params.taskId as string;
  const task = tasks.get(taskId);

  if (!task) {
    throw new Error("Task not found");
  }

  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  console.log("JSON-RPC tasks/get response:", {
    summary: {
      taskId: task.id,
      state: task.status.state,
      message: task.status.message.parts[0]?.text,
    },
  });
  return formattedTask;
}

/**
 * Handle tasks/cancel - cancels a running task
 */
async function handleTasksCancel({
  params,
}: JsonRpcHandlerParams): Promise<unknown> {
  const taskId = params.taskId as string;
  const task = tasks.get(taskId);

  if (!task) {
    throw new Error("Task not found");
  }

  const fromState = task.status.state;
  const cancelState: TaskState = "canceled";

  if (!isValidTransition(fromState, cancelState)) {
    throw new Error("Task cannot be canceled from current state");
  }

  task.status.state = cancelState;
  task.status.message.parts = [
    {
      kind: "text",
      text: prefixAgentMessage("This task has been canceled."),
    },
  ];
  task.status.timestamp = new Date().toISOString();

  console.log("Task transitioned:", {
    taskId,
    fromState,
    toState: cancelState,
  });

  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  console.log("JSON-RPC tasks/cancel response:", {
    taskId: task.id,
    state: task.status.state,
    message: task.status.message.parts[0]?.text,
  });
  return formattedTask;
}

// ============================================================================
// SSE Streaming Utilities
// ============================================================================

/**
 * Write a single SSE event to the response stream.
 * Each event is a JSON-RPC 2.0 response whose `result` is a `StreamResponse`.
 */
function writeSseEvent(
  res: import("express").Response,
  id: string,
  result: StreamResponse,
): void {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  res.write(`data: ${payload}\n\n`);
}

/**
 * The joke steps streamed to the client:
 *   1. "Knock, knock."          (working)
 *   2. "Otto."                  (working)
 *   3. "Otto-matically done!"   (completed, final)
 *
 * Delays are in milliseconds — kept short for a snappy demo.
 */
const JOKE_STEPS: Array<{
  delayMs: number;
  state: TaskState;
  text: string;
  final: boolean;
}> = [
  { delayMs: 1000, state: "working", text: "Knock, knock.", final: false },
  { delayMs: 2000, state: "working", text: "Otto.", final: false },
  {
    delayMs: 3000,
    state: "completed",
    text: "Otto-matically done! 🤖",
    final: true,
  },
];

/**
 * Stream the knock-knock joke as SSE events, updating the stored task at each step.
 * Closes `res` when the final event has been sent.
 */
function streamJokeSteps(
  res: import("express").Response,
  requestId: string,
  task: Task,
  context: import("./storage.js").AgentContext,
): void {
  let stepIndex = 0;

  function sendNext(): void {
    if (stepIndex >= JOKE_STEPS.length) {
      res.end();
      return;
    }

    const step = JOKE_STEPS[stepIndex++];

    setTimeout(() => {
      const now = new Date().toISOString();

      // Update the stored task
      task.status.state = step.state;
      task.status.timestamp = now;
      task.status.message.parts = [
        { kind: "text", text: prefixAgentMessage(step.text) },
      ];
      saveData();

      // Add to context history
      context.messages.push({
        role: "agent",
        text: prefixAgentMessage(step.text),
        timestamp: now,
      });

      const statusUpdate: TaskStatusUpdateEvent = {
        taskId: task.id,
        contextId: task.contextId,
        status: { state: step.state, timestamp: now },
        message: {
          role: "agent",
          parts: [{ kind: "text", text: prefixAgentMessage(step.text) }],
          messageId: generateId("msg"),
          taskId: task.id,
          contextId: task.contextId,
          kind: "message",
        },
        kind: "status-update",
        final: step.final,
      };

      writeSseEvent(res, requestId, { statusUpdate });

      console.log("SSE event sent:", {
        taskId: task.id,
        state: step.state,
        final: step.final,
        text: step.text,
      });

      if (step.final) {
        res.end();
      } else {
        sendNext();
      }
    }, step.delayMs);
  }

  sendNext();
}

// ============================================================================
// Streaming JSON-RPC Handlers
// ============================================================================

/**
 * Handle message/send with SSE streaming response.
 * Called when Jira sends `Accept: text/event-stream` (i.e. streaming: true in manifest).
 *
 * Emits:
 *   1. { task }          — initial task object (submitted → working)
 *   2. { statusUpdate }  — intermediate joke steps (working)
 *   3. { statusUpdate, final: true } — completed step, then closes stream
 */
async function handleSendStreamingMessage(
  _req: import("express").Request,
  res: import("express").Response,
  params: Record<string, unknown>,
  requestId: string,
  cloudId: string | undefined,
): Promise<void> {
  const { message } = params as {
    message: { contextId?: string; parts: unknown[] };
  };
  const taskId = generateId("task");

  const { contextId, workItemId, userAccountId, context } =
    resolveMessageContext(message, cloudId);

  // Create task in working state immediately
  const now = new Date().toISOString();
  const initialText = workItemId
    ? `I'm working on ${workItemId}...`
    : "I'm working on this...";

  const task = {
    id: taskId,
    contextId,
    status: {
      state: "working" as TaskState,
      message: {
        role: "agent" as const,
        parts: [
          { kind: "text" as const, text: prefixAgentMessage(initialText) },
        ],
        messageId: generateId("msg"),
        taskId,
        contextId,
        kind: "message" as const,
      },
      timestamp: now,
    },
    kind: "task" as const,
    userAccountId,
    workItemId,
  } satisfies Task;

  tasks.set(taskId, task);
  saveData();

  console.log("Streaming task created:", { taskId, contextId, workItemId });

  // Start SSE response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // First event: the initial task object
  const formattedTask = formatAgentConnectorTaskResponse(task, contextId);
  writeSseEvent(res, requestId, { task: formattedTask as Task });

  // Stream joke steps asynchronously
  streamJokeSteps(res, requestId, task, context);
}

/**
 * Handle tasks/resubscribe — Jira calls this to reconnect to a dropped SSE stream.
 * Responds with the current task state as the first (and possibly final) event.
 */
async function handleTasksResubscribe(
  res: import("express").Response,
  params: Record<string, unknown>,
  requestId: string,
): Promise<void> {
  const taskId = (params.id || params.taskId) as string;
  const task = tasks.get(taskId);

  if (!task) {
    // Can't SSE-error cleanly, send a JSON-RPC error event and close
    const errorPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      error: { code: -32001, message: "Task not found" },
    });
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    res.write(`data: ${errorPayload}\n\n`);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Always send the current task as the first event
  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  writeSseEvent(res, requestId, { task: formattedTask as Task });

  console.log("Resubscribe: sent current task state:", {
    taskId,
    state: task.status.state,
  });

  // If already in terminal state, close immediately
  if (
    task.status.state === "completed" ||
    task.status.state === "failed" ||
    task.status.state === "canceled" ||
    task.status.state === "rejected"
  ) {
    res.end();
    return;
  }

  // Task still active — resume streaming remaining joke steps
  const context = contexts.get(task.contextId);
  if (context) {
    streamJokeSteps(res, requestId, task, context);
  } else {
    res.end();
  }
}

// Method handler map
const methodHandlers: Record<JsonRpcMethod, JsonRpcHandler> = {
  [JSON_RPC_METHODS.MESSAGE_SEND]: handleMessageSend,
  [JSON_RPC_METHODS.TASKS_GET]: handleTasksGet,
  [JSON_RPC_METHODS.TASKS_CANCEL]: handleTasksCancel,
  // tasks/resubscribe is handled separately in the route (needs res access)
  [JSON_RPC_METHODS.TASKS_RESUBSCRIBE]: async () => {
    throw new Error("tasks/resubscribe must be handled via streaming route");
  },
};

// JSON-RPC error code mapping
const JSON_RPC_ERROR_CODES = new Map([
  ["Task not found", -32001],
  ["Context not found", -32003],
  ["Task cannot be canceled from current state", -32002],
]);

// ============================================================================
// Route: Installation Webhook
// ============================================================================

app.post("/atlassian/installed", authMiddleware, async (req, res) => {
  console.log(
    "Installation webhook received:",
    JSON.stringify(req.body, null, 2),
  );

  const { context, installationId, installerAccountId } = req.body;
  const cloudIdResult = extractCloudId(context);
  if (cloudIdResult.isErr()) {
    console.error(
      "Failed to extract cloudId from context:",
      context,
      cloudIdResult.error,
    );
    return res.status(400).json({ error: "Invalid context ARI format" });
  }
  const cloudId = cloudIdResult.value;

  try {
    // Fetch base URL from Jira
    const serverInfoResponse = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/serverInfo`,
    );
    const serverData = (await serverInfoResponse.json()) as { baseUrl: string };
    console.log("Jira server info fetched:", JSON.stringify(serverData));

    // Store installation
    const installation: JiraInstallation = {
      cloudId,
      installationId,
      baseUrl: serverData.baseUrl,
      installerAccountId,
      installedAt: new Date().toISOString(),
    };

    installations.set(cloudId, installation);
    saveData();

    console.log("Installation stored:", installation);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Installation processing failed:", error);
    res.status(500).json({ error: "Failed to process installation" });
  }
});

// ============================================================================
// Route: A2A JSON-RPC Endpoint
// ============================================================================

/**
 * Handle a POST /a2a/json-rpc request.
 *
 * Detects whether Jira wants an SSE streaming response (Accept: text/event-stream)
 * and routes to the appropriate handler:
 *   - Streaming message/send  → handleSendStreamingMessage (SSE)
 *   - tasks/resubscribe       → handleTasksResubscribe (SSE)
 *   - All other methods       → methodHandlers map (JSON)
 */
async function handleA2aJsonRpc(
  req: AuthenticatedRequest,
  res: import("express").Response,
): Promise<void> {
  const cloudId = req.fitPayload?.context?.cloudId;
  if (!cloudId) {
    console.warn("Could not extract cloudId from FIT payload", {
      hasPayload: !!req.fitPayload,
      hasContext: !!req.fitPayload?.context,
    });
  }

  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== "2.0") {
    res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request" },
    });
    return;
  }

  console.log(
    `JSON-RPC ${method} called:`,
    JSON.stringify({ id, params }, null, 2),
  );

  const wantsStream = (req.headers.accept ?? "").includes("text/event-stream");

  try {
    if (method === JSON_RPC_METHODS.MESSAGE_SEND && wantsStream) {
      await handleSendStreamingMessage(
        req,
        res,
        params as Record<string, unknown>,
        String(id),
        cloudId,
      );
      return;
    }

    if (method === JSON_RPC_METHODS.TASKS_RESUBSCRIBE) {
      await handleTasksResubscribe(
        res,
        params as Record<string, unknown>,
        String(id),
      );
      return;
    }

    const handler = methodHandlers[method as JsonRpcMethod];
    if (!handler) {
      res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }

    const result = await handler({ params, id, cloudId });
    const successResponse = { jsonrpc: "2.0", id, result };

    if (method === JSON_RPC_METHODS.MESSAGE_SEND) {
      console.log(
        "JSON-RPC message/send response:",
        JSON.stringify(successResponse, null, 2),
      );
    }
    if (method === JSON_RPC_METHODS.TASKS_GET) {
      console.log(
        "JSON-RPC tasks/get response (full):",
        JSON.stringify(successResponse, null, 2),
      );
    }

    res.json(successResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = JSON_RPC_ERROR_CODES.get(errorMessage) ?? -32603;
    console.error("JSON-RPC error:", {
      method,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: errorCode, message: errorMessage },
    });
  }
}

app.post("/a2a/json-rpc", authMiddleware, handleA2aJsonRpc);

// ============================================================================
// Route: Configuration (Optional)
// ============================================================================

app.post("/atlassian/config", authMiddleware, (req, res) => {
  console.log("Configuration request:", req.body);

  // Handle admin/personal settings configuration
  // This would typically store configuration in a database

  res.json({ success: true });
});

// ============================================================================
// Task State Management (Demo/Development Only)
// ============================================================================

/**
 * DEMO ENDPOINT - Not part of the remote agent contract
 *
 * This endpoint allows manual task progression for development and testing.
 * In a real implementation, agents would manage task state transitions
 * through proper task processing logic, not HTTP endpoints.
 *
 * This endpoint is provided as a convenience for:
 * - Manual testing during development
 * - Demo scenarios where automatic task completion isn't available
 * - Debugging task state transitions
 */
interface AdvanceTaskRequest {
  state: TaskState;
  message?: string;
}

app.post("/tasks/:taskId/advance", (req, res) => {
  const { taskId } = req.params;
  const { state: newState, message } = req.body as AdvanceTaskRequest;

  console.log("Task advance requested:", { taskId, newState, message });

  // Validate task exists
  const task = tasks.get(taskId);
  if (!task) {
    console.error("Task advance error: Task not found", { taskId });
    return res.status(404).json({
      error: "Task not found",
      taskId,
    });
  }

  // Validate state transition using authoritative rules from forge-ahead
  const currentState = task.status.state;
  if (!isValidTransition(currentState, newState)) {
    console.error("Task advance error: Invalid state transition", {
      taskId,
      currentState,
      requestedState: newState,
    });
    return res.status(400).json({
      error: `Invalid state transition: ${currentState} -> ${newState}`,
      currentState,
      requestedState: newState,
    });
  }

  // Update task state
  task.status.state = newState;
  task.status.timestamp = new Date().toISOString();

  // Update message if provided
  if (message) {
    task.status.message.parts = [
      {
        kind: "text",
        text: prefixAgentMessage(message),
      },
    ];
  }

  // Save to file
  saveData();

  console.log("Task advanced successfully:", {
    taskId,
    fromState: currentState,
    toState: newState,
    message: task.status.message.parts[0]?.text,
  });

  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  res.json({
    success: true,
    task: formattedTask,
  });
});

/**
 * Internal state transition function - called synchronously during request handling
 * This acknowledges the task and marks the agent as working on it
 */
function transitionTaskToWorking(taskId: string, context: AgentContext): void {
  console.log("Attempting task auto-transition to working:", { taskId });

  const task = tasks.get(taskId);
  if (!task) {
    console.error("Task not found for state transition:", taskId);
    return;
  }

  const fromState = task.status.state;
  const toState: TaskState = "working";

  // Validate the transition using authoritative rules
  if (!isValidTransition(fromState, toState)) {
    console.error("Invalid state transition:", { taskId, fromState, toState });
    return;
  }

  // Transition from 'submitted' to 'working'
  task.status.state = toState;
  task.status.timestamp = new Date().toISOString();

  // Update message to indicate work has started
  const workingMessage = prefixAgentMessage("I'm now working on this task...");
  task.status.message.parts = [
    {
      kind: "text",
      text: workingMessage,
    },
  ];

  // Add the working message to context
  context.messages.push({
    role: "agent",
    text: workingMessage,
    timestamp: task.status.timestamp,
  });

  console.log("Task transitioned:", {
    taskId,
    fromState,
    toState,
    contextId: context.id,
    workItemId: task.workItemId,
  });
}

// ============================================================================
// Start Server
// ============================================================================

if (process.env.NODE_ENV !== "test") {
  // Load data on startup
  loadData();

  app.listen(PORT, () => {
    console.log(`Remote agent backend service running on port ${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  - POST /atlassian/installed`);
    console.log(`  - POST /a2a/json-rpc`);
    console.log(`  - POST /atlassian/config`);
    console.log(`  - POST /tasks/:taskId/advance`);
  });
}
