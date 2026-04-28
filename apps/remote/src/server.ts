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

const app = express();
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
// JSON-RPC Method Definitions
// ============================================================================

const JSON_RPC_METHODS = {
  MESSAGE_SEND: "message/send",
  TASKS_GET: "tasks/get",
  TASKS_CANCEL: "tasks/cancel",
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
  const contextId = message.contextId || generateId("ctx");
  const taskId = generateId("task");

  // Extract work item and user info from message data
  let workItemId: string | undefined;
  let userAccountId: string | undefined;

  for (const part of message.parts) {
    if (
      (part as { kind: string }).kind === "data" &&
      (part as { data?: unknown }).data
    ) {
      const data = (part as { data: Record<string, unknown> }).data;
      // Extract issue ID from the nested structure
      workItemId =
        (data.issue as { id?: string })?.id ||
        (data.issueId as string) ||
        (data.workItemId as string);
      userAccountId = data.userAccountId as string;
    }
  }

  // Create or update context
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

  // Add user message to context
  for (const part of message.parts) {
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
  // NOTE: Docs specify 'taskId' but Jira actually sends 'id'
  const taskId = (params.id || params.taskId) as string;
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
  // NOTE: Docs specify 'taskId' but Jira actually sends 'id'
  const taskId = (params.id || params.taskId) as string;
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

// Method handler map
const methodHandlers: Record<JsonRpcMethod, JsonRpcHandler> = {
  [JSON_RPC_METHODS.MESSAGE_SEND]: handleMessageSend,
  [JSON_RPC_METHODS.TASKS_GET]: handleTasksGet,
  [JSON_RPC_METHODS.TASKS_CANCEL]: handleTasksCancel,
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

app.post(
  "/a2a/json-rpc",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const _systemToken = req.headers["x-forge-oauth-system"] as string;
    const _userToken = req.headers["x-forge-oauth-user"] as string;

    // Extract cloudId from validated FIT payload
    const cloudId = req.fitPayload?.context?.cloudId;

    if (!cloudId) {
      console.warn("Could not extract cloudId from FIT payload", {
        hasPayload: !!req.fitPayload,
        hasContext: !!req.fitPayload?.context,
        context: req.fitPayload?.context,
      });
    }

    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== "2.0") {
      const errorResponse = {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request" },
      };
      console.error("JSON-RPC invalid request:", errorResponse);
      return res.status(400).json(errorResponse);
    }

    console.log(
      `JSON-RPC ${method} called:`,
      JSON.stringify({ id, params }, null, 2),
    );

    try {
      // Dispatch to appropriate handler based on method
      const handler = methodHandlers[method as JsonRpcMethod];

      if (!handler) {
        const errorResponse = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        };
        console.error("JSON-RPC unknown method:", { method, errorResponse });
        return res.json(errorResponse);
      }

      const result = await handler({ params, id, cloudId });
      const successResponse = {
        jsonrpc: "2.0",
        id,
        result,
      };

      if (method === JSON_RPC_METHODS.MESSAGE_SEND) {
        console.log("JSON-RPC message/send response:");
        console.log(JSON.stringify(successResponse, null, 2));
      }

      if (method === JSON_RPC_METHODS.TASKS_GET) {
        console.log("JSON-RPC tasks/get response (full):");
        console.log(JSON.stringify(successResponse, null, 2));
      }

      return res.json(successResponse);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode = JSON_RPC_ERROR_CODES.get(errorMessage) ?? -32603;

      const errorResponse = {
        jsonrpc: "2.0",
        id,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      };

      console.error("JSON-RPC error:", {
        method,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.json(errorResponse);
    }
  },
);

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
