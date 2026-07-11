/**
 * Remote Agent Backend Service
 *
 * This service integrates with the Forge app to handle Jira Remote Agent tasks.
 * It implements the Agent2Agent (A2A) JSON-RPC protocol for task management.
 */

import path from "node:path";
import express from "express";
import {
  extractCloudId,
  formatAgentConnectorTaskResponse,
  isTerminalState,
  isValidTransition,
  type MappedEvent,
  type TaskState,
} from "forge-ahead";
import { type AuthenticatedRequest, authMiddleware } from "./auth.js";
import {
  loadScenarios,
  matchScenario,
  type ScenarioStep,
} from "./scenarios.js";
import { mapScenarioStep, runScenario } from "./simulator.js";
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

  const activeStream = activeScenarioStreams.get(taskId);
  if (activeStream) {
    stopActiveStreamWithCancellation(task, activeStream);
  } else {
    task.status.message.parts = [
      {
        kind: "text",
        text: prefixAgentMessage("Canceling..."),
      },
    ];
    task.status.timestamp = new Date().toISOString();
    console.log("Task cancellation requested:", { taskId, fromState });
    scheduleCancellationStop(taskId);
  }

  saveData();
  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  console.log("JSON-RPC tasks/cancel response:", {
    taskId: task.id,
    state: task.status.state,
    message: task.status.message.parts[0]?.text,
  });
  return formattedTask;
}

/**
 * Simulate the Remote Agent runtime acknowledging a stop request: after a
 * short delay, transition the task to terminal `canceled` and persist it.
 * Polling clients observe this on a later `tasks/get` (see
 * docs/adr/0019-canceled-is-emitted-after-runtime-stop.md).
 */
function scheduleCancellationStop(taskId: string): void {
  setTimeout(() => {
    const task = tasks.get(taskId);
    if (!task || isTerminalState(task.status.state)) {
      return;
    }

    task.status.state = "canceled";
    task.status.message.parts = [
      {
        kind: "text",
        text: prefixAgentMessage("This task has been canceled."),
      },
    ];
    task.status.timestamp = new Date().toISOString();
    saveData();

    console.log("Task transitioned:", {
      taskId,
      toState: "canceled",
    });
  }, CANCELLATION_STOP_DELAY_MS);
}

/**
 * Stop an actively streaming Simulation Scenario and coordinate cancellation
 * over its open SSE connection: stop scenario playback, report cancellation
 * progress as a Content Update, then emit terminal `canceled` and end the
 * stream (see docs/adr/0019-canceled-is-emitted-after-runtime-stop.md).
 * Artifacts already streamed to this connection stay in its event history -
 * cancellation only appends further events, it never rewrites past ones
 * (see docs/adr/0016-artifacts-survive-task-interruptions.md).
 */
function stopActiveStreamWithCancellation(
  task: Task,
  activeStream: ActiveScenarioStream,
): void {
  activeStream.cancelPlayback();
  activeScenarioStreams.delete(task.id);

  const cancelingEvent: MappedEvent = {
    kind: "content-update",
    message: "Canceling...",
  };
  applyMappedEventToTask(cancelingEvent, task, activeStream.context);
  writeSseEvent(
    activeStream.res,
    activeStream.requestId,
    buildStreamResponseFromEvent(cancelingEvent, task),
  );

  const canceledEvent: MappedEvent = {
    kind: "task-state-update",
    state: "canceled",
    final: true,
    message: "This task has been canceled.",
  };
  applyMappedEventToTask(canceledEvent, task, activeStream.context);
  writeSseEvent(
    activeStream.res,
    activeStream.requestId,
    buildStreamResponseFromEvent(canceledEvent, task),
  );
  activeStream.res.end();

  console.log("Task transitioned:", {
    taskId: task.id,
    toState: "canceled",
  });
}

// ============================================================================
// SSE Streaming Utilities
// ============================================================================

/**
 * A Simulation Scenario currently being streamed to an open SSE connection
 * for a task, keyed by taskId. Lets `tasks/cancel` stop an actively running
 * simulated task's scenario playback and end its stream with a coordinated
 * `canceled`, instead of only affecting tasks reachable by polling (see
 * docs/adr/0019-canceled-is-emitted-after-runtime-stop.md).
 */
interface ActiveScenarioStream {
  cancelPlayback: () => void;
  res: import("express").Response;
  requestId: string;
  context: AgentContext;
}
const activeScenarioStreams = new Map<string, ActiveScenarioStream>();

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
 * Apply a mapped Simulation Scenario event to a task's stored state: update
 * the A2A task state (task-state-update steps only), set the status message
 * text, append to context history, and persist.
 */
function applyMappedEventToTask(
  event: MappedEvent,
  task: Task,
  context: AgentContext,
): void {
  const now = new Date().toISOString();

  if (event.kind === "task-state-update") {
    task.status.state = event.state;
  }
  task.status.timestamp = now;

  if (event.kind !== "artifact-update" && event.message) {
    const text = prefixAgentMessage(event.message);
    task.status.message.parts = [{ kind: "text", text }];
    context.messages.push({ role: "agent", text, timestamp: now });
  }

  saveData();
}

/**
 * Build the SSE `StreamResponse` payload for a mapped Simulation Scenario
 * event, reading the task's current (already-applied) status.
 */
function buildStreamResponseFromEvent(
  event: MappedEvent,
  task: Task,
): StreamResponse {
  if (event.kind === "artifact-update") {
    const artifactUpdate: TaskArtifactUpdateEvent = {
      taskId: task.id,
      contextId: task.contextId,
      artifact: event.artifact,
      kind: "artifact-update",
      ...(event.append !== undefined && { append: event.append }),
      ...(event.lastChunk !== undefined && { lastChunk: event.lastChunk }),
    };
    return { artifactUpdate };
  }

  const statusUpdate: TaskStatusUpdateEvent = {
    taskId: task.id,
    contextId: task.contextId,
    status: { state: task.status.state, timestamp: task.status.timestamp },
    message: task.status.message,
    kind: "status-update",
    final: event.kind === "task-state-update" ? event.final : false,
  };
  return { statusUpdate };
}

/**
 * Run the remainder of a Simulation Scenario as SSE events: apply each
 * mapped event to the stored task, write it to the stream, and close the
 * response once a step is final or waits for user input.
 *
 * `allSteps` is the matched scenario's full, unsliced step list (stable
 * object references), used to record `nextStepIndex` after every applied
 * step - not only at a pause - so a later message/send resumption or
 * `tasks/resubscribe` knows where to continue without replaying steps
 * already streamed (see docs/adr/0006 and docs/adr/0015).
 */
function streamScenarioSteps(
  res: import("express").Response,
  requestId: string,
  task: Task,
  context: AgentContext,
  allSteps: ScenarioStep[],
  steps: ScenarioStep[],
): void {
  const playback = runScenario(steps, (event, step) => {
    task.nextStepIndex = allSteps.indexOf(step) + 1;
    applyMappedEventToTask(event, task, context);
    writeSseEvent(res, requestId, buildStreamResponseFromEvent(event, task));

    console.log("Scenario event streamed:", {
      taskId: task.id,
      kind: event.kind,
      state: task.status.state,
      final: step.final ?? false,
    });

    if (step.final || step.waitForUserInput) {
      activeScenarioStreams.delete(task.id);
      res.end();
    }
  });

  activeScenarioStreams.set(task.id, {
    cancelPlayback: playback.cancel,
    res,
    requestId,
    context,
  });
}

/**
 * Fold a scenario's leading step into the task's current status in place of
 * a separate SSE event: normally `working`, or an immediate
 * interrupted/terminal state (see docs/adr/0021). Used both when a task is
 * first created and when it resumes from a pause (see docs/adr/0017), so a
 * `working` Task State Update always precedes the remaining streamed steps.
 *
 * An artifact-update step can't be a task's status, so it is left in the
 * returned remaining steps instead of being folded.
 *
 * `allSteps` is the matched scenario's full, unsliced step list, used to
 * record `nextStepIndex` for the folded step the same way `streamScenarioSteps`
 * does for streamed steps.
 */
function foldLeadingStep(
  allSteps: ScenarioStep[],
  steps: ScenarioStep[],
  task: Task,
  context: AgentContext,
): { remaining: ScenarioStep[]; folded?: ScenarioStep } {
  const [firstStep, ...rest] = steps;
  if (!firstStep) {
    return { remaining: [] };
  }

  const firstMapped = mapScenarioStep(firstStep);
  if (firstMapped.kind === "artifact-update") {
    return { remaining: steps };
  }

  task.nextStepIndex = allSteps.indexOf(firstStep) + 1;
  applyMappedEventToTask(firstMapped, task, context);
  return { remaining: rest, folded: firstStep };
}

// ============================================================================
// Streaming JSON-RPC Handlers
// ============================================================================

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
    if (existingTask && isResumableState(existingTask.status.state)) {
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

  const { contextId, workItemId, userAccountId, context } =
    resolveMessageContext(message, cloudId);

  const { scenario, matchedBy } = matchScenario(
    scenarios,
    extractTaskText(message.parts),
  );
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

  const { remaining, folded } = foldLeadingStep(
    scenario.steps,
    scenario.steps,
    task,
    context,
  );

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

  if (folded && (folded.final || folded.waitForUserInput)) {
    res.end();
    return;
  }

  streamScenarioSteps(res, requestId, task, context, scenario.steps, remaining);
}

/**
 * A task can be resumed by any subsequent user input while it's paused at
 * `auth-required` or `input-required`, per docs/adr/0015 and the initial
 * A2A Simulator happy path (see docs/adr/0036). Other interruption states
 * are out of scope for this pass.
 */
function isResumableState(state: TaskState): boolean {
  return state === "auth-required" || state === "input-required";
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
  const { context } = resolveMessageContext(message, cloudId);

  const scenario = scenarios.find(
    (candidate) => candidate.id === task.scenarioId,
  );
  if (!scenario) {
    throw new Error("Scenario not found for resumed task");
  }

  const resumedAtStepIndex = task.nextStepIndex ?? 0;
  const pausedSteps = scenario.steps.slice(resumedAtStepIndex);
  const { remaining, folded } = foldLeadingStep(
    scenario.steps,
    pausedSteps,
    task,
    context,
  );

  saveData();

  console.log("Streaming task resumed:", {
    taskId: task.id,
    scenarioId: scenario.id,
    resumedAtStepIndex,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const formattedTask = formatAgentConnectorTaskResponse(task, task.contextId);
  writeSseEvent(res, requestId, { task: formattedTask as Task });

  if (folded && (folded.final || folded.waitForUserInput)) {
    res.end();
    return;
  }

  streamScenarioSteps(res, requestId, task, context, scenario.steps, remaining);
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

  // A terminal task has nothing further to stream. A task paused at
  // auth-required/input-required also has nothing further to stream until
  // the user responds via message/send (see docs/adr/0036) - resubscribing
  // must not auto-continue past that pause on its own. Both cases close
  // immediately after reporting the current snapshot.
  if (
    isTerminalState(task.status.state) ||
    isResumableState(task.status.state)
  ) {
    res.end();
    return;
  }

  // Task still active — take over any still-open prior connection for this
  // task so it doesn't keep streaming in parallel with this one, then
  // continue the matched Simulation Scenario from the next step that hasn't
  // been applied yet, rather than replaying steps already streamed (see
  // docs/adr/0006).
  const priorStream = activeScenarioStreams.get(taskId);
  if (priorStream) {
    priorStream.cancelPlayback();
    activeScenarioStreams.delete(taskId);
    priorStream.res.end();
  }

  const context = contexts.get(task.contextId);
  const scenario = scenarios.find(
    (candidate) => candidate.id === task.scenarioId,
  );
  if (context && scenario) {
    const remaining = scenario.steps.slice(task.nextStepIndex ?? 0);
    streamScenarioSteps(
      res,
      requestId,
      task,
      context,
      scenario.steps,
      remaining,
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
