/**
 * Remote Agent Backend Service
 *
 * This service integrates with the Forge app to handle Jira Remote Agent tasks.
 * It implements the Agent2Agent (A2A) JSON-RPC protocol for task management.
 */

import path from "node:path";
import {
  fromPromise,
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "@forge-ahead/errors";
import express from "express";
import {
  extractCloudId,
  formatAgentConnectorTaskResponse,
  isValidTransition,
  type MappedEvent,
  type TaskState,
} from "forge-ahead";
import {
  createA2aJsonRpcSessionStream,
  startA2aJsonRpcStream,
  writeA2aJsonRpcStreamError,
  writeA2aJsonRpcTaskSnapshot,
} from "./a2aStream.js";
import { type AuthenticatedRequest, authMiddleware } from "./auth.js";
import { isResumableTaskState } from "./scenarioSession.js";
import {
  prefixAgentMessage,
  SimulationScenarioSessionRuntime,
} from "./scenarioSessionRuntime.js";
import { loadScenarios, matchScenario, type Scenario } from "./scenarios.js";
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

export const app = express();
app.use(express.json());

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000;

// A2A Simulator: Simulation Scenarios are loaded once at startup from
// human-editable YAML files (see docs/adr/0035).
const SCENARIOS_DIR = path.join(process.cwd(), "scenarios");
const scenariosResult = loadScenarios(SCENARIOS_DIR);
if (scenariosResult.isErr()) {
  throw new Error(
    `Failed to load Simulation Scenarios: ${scenariosResult.error.detail}`,
  );
}
const scenarios = scenariosResult.value;

// Cancellation is not immediate: the Reference Implementation simulates
// asking the runtime to stop before emitting terminal `canceled` (see
// docs/adr/0019-canceled-is-emitted-after-runtime-stop.md).
const CANCELLATION_STOP_DELAY_MS = 50;

const simulationScenarioSessions = new SimulationScenarioSessionRuntime({
  store: {
    getTask: (taskId) => tasks.get(taskId),
    setTask: (task) => {
      tasks.set(task.id, task);
    },
    save: saveData,
  },
  cancellationStopDelayMs: CANCELLATION_STOP_DELAY_MS,
  log: (message, data) => {
    console.log(message, data);
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
 * Returns a Result error if the context cannot be found after creation
 * (should never happen).
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
 * Join every text part in `parts` into a single string for Scenario Matching.
 */
function extractTaskText(parts: unknown[]): string {
  return parts
    .filter((part) => (part as { kind?: string }).kind === "text")
    .map((part) => (part as { text?: string }).text ?? "")
    .join(" ");
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
): Result<MessageContext, ProblemDetails> {
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
    return StandardError.getOrDefault(404).error("Context not found");
  }

  recordUserMessages(rawMessage.parts, context);

  return ok({ contextId, workItemId, userAccountId, context });
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

type JsonRpcHandler = (
  args: JsonRpcHandlerParams,
) => Promise<Result<unknown, ProblemDetails>>;

// ============================================================================
// JSON-RPC Method Handlers
// ============================================================================

/**
 * Handle message/send - creates a new task and context for the agent
 */
async function handleMessageSend({
  params,
  cloudId,
}: JsonRpcHandlerParams): Promise<Result<unknown, ProblemDetails>> {
  const { message } = params as {
    message: { contextId?: string; parts: unknown[] };
  };
  const taskId = generateId("task");

  const contextResult = resolveMessageContext(message, cloudId);
  if (contextResult.isErr()) {
    return contextResult;
  }
  const { contextId, workItemId, userAccountId, context } =
    contextResult.value;

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
    return StandardError.getOrDefault(404).error(
      "Task not found after creation",
    );
  }

  const formattedTask = formatAgentConnectorTaskResponse(
    updatedTask,
    contextId,
  );
  return ok(formattedTask);
}

/**
 * Handle tasks/get - retrieves current task status
 */
async function handleTasksGet({
  params,
}: JsonRpcHandlerParams): Promise<Result<unknown, ProblemDetails>> {
  const taskId = (params.id || params.taskId) as string;
  const task = tasks.get(taskId);

  if (!task) {
    return StandardError.getOrDefault(404).error("Task not found");
  }

  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  console.log("JSON-RPC tasks/get response:", {
    summary: {
      taskId: task.id,
      state: task.status.state,
      message: task.status.message.parts[0]?.text,
    },
  });
  return ok(formattedTask);
}

/**
 * Handle tasks/cancel - cancels a running task
 */
async function handleTasksCancel({
  params,
}: JsonRpcHandlerParams): Promise<Result<unknown, ProblemDetails>> {
  const taskId = (params.id || params.taskId) as string;
  const taskResult = simulationScenarioSessions.cancel(taskId);
  if (taskResult.isErr()) {
    return taskResult;
  }
  const task = taskResult.value;
  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  console.log("JSON-RPC tasks/cancel response:", {
    taskId: task.id,
    state: task.status.state,
    message: task.status.message.parts[0]?.text,
  });
  return ok(formattedTask);
}

// ============================================================================
// Streaming JSON-RPC Handlers
// ============================================================================

function logStreamedScenarioEvent(
  event: MappedEvent,
  task: Task,
  scenario: Scenario,
): void {
  console.log("Scenario event streamed:", {
    taskId: task.id,
    scenarioId: scenario.id,
    step: `${task.nextStepIndex ?? 0}/${scenario.steps.length}`,
    kind: event.kind,
    state: task.status.state,
    final: event.kind === "task-state-update" ? event.final : false,
  });
}

/**
 * Handle message/send with SSE streaming response.
 * Called when Jira sends `Accept: text/event-stream` (i.e. streaming: true in manifest).
 *
 * A Simulation Scenario is matched from the starting task text (see
 * docs/adr/0033) and drives the stream from task acceptance through
 * completion or interruption (see docs/adr/0021):
 *   1. { task }                       — initial task, reflecting the matched
 *                                        scenario's first step (normally
 *                                        `working`, or an immediate
 *                                        interrupted/terminal state)
 *   2. { statusUpdate | artifactUpdate } — remaining scenario steps, in order
 */
async function handleSendStreamingMessage(
  _req: import("express").Request,
  res: import("express").Response,
  params: Record<string, unknown>,
  requestId: string,
  cloudId: string | undefined,
): Promise<void> {
  const { message } = params as {
    message: { contextId?: string; taskId?: string; parts: unknown[] };
  };

  if (message.taskId) {
    const existingTask = tasks.get(message.taskId);
    if (existingTask && isResumableTaskState(existingTask.status.state)) {
      await handleResumeStreamingMessage(
        res,
        requestId,
        existingTask,
        message,
        cloudId,
      );
      return;
    }
  }

  const taskId = generateId("task");

  const contextResult = resolveMessageContext(message, cloudId);
  if (contextResult.isErr()) {
    writeStreamProblem(res, requestId, contextResult.error);
    return;
  }
  const { contextId, workItemId, userAccountId, context } =
    contextResult.value;

  const matchResult = matchScenario(scenarios, extractTaskText(message.parts));
  if (matchResult.isErr()) {
    writeStreamProblem(res, requestId, matchResult.error);
    return;
  }
  const { scenario, matchedBy } = matchResult.value;
  console.log("Streaming task matched Simulation Scenario:", {
    taskId,
    scenarioId: scenario.id,
    matchedBy,
  });

  const now = new Date().toISOString();
  const task = {
    id: taskId,
    contextId,
    status: {
      state: "working" as TaskState,
      message: {
        role: "agent" as const,
        parts: [],
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
    scenarioId: scenario.id,
  } satisfies Task;

  const continuation = simulationScenarioSessions.start(
    task,
    context,
    scenario,
  );

  console.log("Streaming task created:", { taskId, contextId, workItemId });

  startA2aJsonRpcStream(res);
  writeA2aJsonRpcTaskSnapshot(res, requestId, task);

  simulationScenarioSessions.attachStream(
    task,
    context,
    scenario,
    createA2aJsonRpcSessionStream({
      response: res,
      requestId,
      onEvent: (event, task) => logStreamedScenarioEvent(event, task, scenario),
    }),
    continuation,
  );
}

/**
 * Resume a paused task's SSE stream from a follow-up message/send: record
 * the user's input in the same context, transition back to `working` before
 * any further Content Updates or Artifact updates (see docs/adr/0017), and
 * continue the matched Simulation Scenario from where it paused. Task
 * identity and message history stay connected across the pause (see
 * docs/adr/0015) — no new task or context is created.
 */
async function handleResumeStreamingMessage(
  res: import("express").Response,
  requestId: string,
  task: Task,
  message: { contextId?: string; parts: unknown[] },
  cloudId: string | undefined,
): Promise<void> {
  const contextResult = resolveMessageContext(message, cloudId);
  if (contextResult.isErr()) {
    writeStreamProblem(res, requestId, contextResult.error);
    return;
  }
  const { context } = contextResult.value;

  const scenario = scenarios.find(
    (candidate) => candidate.id === task.scenarioId,
  );
  if (!scenario) {
    writeStreamProblem(
      res,
      requestId,
      StandardError.getOrDefault(404).error(
        "Scenario not found for resumed task",
      ).error,
    );
    return;
  }

  const resumedAtStepIndex = task.nextStepIndex ?? 0;
  const continuation = simulationScenarioSessions.resume(
    task,
    context,
    scenario,
  );

  console.log("Streaming task resumed:", {
    taskId: task.id,
    scenarioId: scenario.id,
    resumedAtStepIndex,
  });

  startA2aJsonRpcStream(res);
  writeA2aJsonRpcTaskSnapshot(res, requestId, task);

  simulationScenarioSessions.attachStream(
    task,
    context,
    scenario,
    createA2aJsonRpcSessionStream({
      response: res,
      requestId,
      onEvent: (event, task) => logStreamedScenarioEvent(event, task, scenario),
    }),
    continuation,
  );
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
    writeStreamProblem(
      res,
      requestId,
      StandardError.getOrDefault(404).error("Task not found").error,
    );
    return;
  }

  startA2aJsonRpcStream(res);
  writeA2aJsonRpcTaskSnapshot(res, requestId, task);

  console.log("Resubscribe: sent current task state:", {
    taskId,
    state: task.status.state,
  });

  const context = contexts.get(task.contextId);
  const scenario = scenarios.find(
    (candidate) => candidate.id === task.scenarioId,
  );
  if (context && scenario) {
    const continuation = simulationScenarioSessions.resubscribe(task, scenario);
    simulationScenarioSessions.attachStream(
      task,
      context,
      scenario,
      createA2aJsonRpcSessionStream({
        response: res,
        requestId,
        onEvent: (event, task) => logStreamedScenarioEvent(event, task, scenario),
      }),
      continuation,
    );
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
  [JSON_RPC_METHODS.TASKS_RESUBSCRIBE]: async () =>
    StandardError.getOrDefault(500).error(
      "tasks/resubscribe must be handled via streaming route",
    ),
};

// Maps RFC 9457 ProblemDetails.status to the JSON-RPC error code the A2A
// transport expects; anything not listed here is an unanticipated failure.
const JSON_RPC_ERROR_CODES_BY_STATUS = new Map<number, number>([
  [404, -32001], // Not Found
  [409, -32002], // Conflict (invalid state transition)
]);
const DEFAULT_JSON_RPC_ERROR_CODE = -32603; // Internal error

function toJsonRpcError(problem: ProblemDetails): {
  code: number;
  message: string;
} {
  return {
    code:
      JSON_RPC_ERROR_CODES_BY_STATUS.get(problem.status) ??
      DEFAULT_JSON_RPC_ERROR_CODE,
    message: problem.detail,
  };
}

/**
 * Write a ProblemDetails as a JSON-RPC error over SSE and end the stream —
 * the streaming-handler counterpart to returning a Result error from a
 * polling JsonRpcHandler.
 */
function writeStreamProblem(
  res: import("express").Response,
  requestId: string,
  problem: ProblemDetails,
): void {
  const { code, message } = toJsonRpcError(problem);
  startA2aJsonRpcStream(res);
  writeA2aJsonRpcStreamError(res, requestId, code, message);
  res.end();
}

// ============================================================================
// Route: Installation Webhook
// ============================================================================

app.post("/atlassian/installed", authMiddleware, async (req, res) => {
  console.log(
    "Installation webhook received:",
    JSON.stringify(req.body, null, 2),
  );

  const { context, id: installationId, installerAccountId } = req.body;
  if (typeof installationId !== "string" || installationId.length === 0) {
    console.error("Installation webhook missing id:", req.body);
    return res.status(400).json({ error: "Missing installation id" });
  }

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

  // Fetch base URL from Jira
  const serverInfoResult = await fromPromise(
    fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/serverInfo`,
    ).then((response) => response.json() as Promise<{ baseUrl: string }>),
    (error) => {
      console.error("Installation processing failed:", error);
      return StandardError.getOrDefault(500).error(
        "Failed to process installation",
      ).error;
    },
  );
  if (serverInfoResult.isErr()) {
    return res
      .status(serverInfoResult.error.status)
      .json({ error: serverInfoResult.error.detail });
  }
  const serverData = serverInfoResult.value;
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

    const handlerResult = await handler({ params, id, cloudId });
    if (handlerResult.isErr()) {
      const { code, message: errorMessage } = toJsonRpcError(
        handlerResult.error,
      );
      console.error("JSON-RPC error:", { method, error: handlerResult.error });
      res.json({ jsonrpc: "2.0", id, error: { code, message: errorMessage } });
      return;
    }

    const successResponse = { jsonrpc: "2.0", id, result: handlerResult.value };

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
    // Last-resort safety net for genuinely unexpected exceptions — expected
    // domain errors are returned as a Result and handled above.
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("JSON-RPC error:", {
      method,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: DEFAULT_JSON_RPC_ERROR_CODE, message: errorMessage },
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
