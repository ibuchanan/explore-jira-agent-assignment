import {
  type AgentCard,
  type Artifact,
  type Message,
  Role,
  type TaskStatus,
  TaskState,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import { jsonRpcHandler } from "@a2a-js/sdk/server/express";
import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "@forge-ahead/errors";
import { log } from "@forge-ahead/logging";
import { ATLASSIAN_FORGE_JWKS_URL } from "@forge-ahead/remote";
import {
  forgeRemoteAuthMiddleware,
  forgeRemoteServerCallContextBuilder,
  forgeRemoteUserBuilder,
} from "@forge-ahead/remote/express";
import express, { type Express } from "express";
import {
  invocationContextFromParts,
  type LoadedScenario,
  loadScenarios,
  selectScenarioWithDiagnostic,
  validateScenarios,
} from "./scenarios.js";

type DiagnosticEvent = Record<string, unknown>;
type Diagnostics = (event: DiagnosticEvent) => void;
type ServerOptions = {
  appAri?: string;
  appId?: string;
  diagnostics?: Diagnostics;
  jwksUrl?: string;
  scenarios?: LoadedScenario[];
};

const taskStates: Record<string, TaskState> = {
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  rejected: TaskState.TASK_STATE_REJECTED,
  failed: TaskState.TASK_STATE_FAILED,
  canceled: TaskState.TASK_STATE_CANCELED,
  "input-required": TaskState.TASK_STATE_INPUT_REQUIRED,
  "auth-required": TaskState.TASK_STATE_AUTH_REQUIRED,
  unknown: TaskState.TASK_STATE_UNSPECIFIED,
};

const agentCard: AgentCard = {
  name: "Agent Simulator",
  description: "Simulates a completed task to verify the A2A connection.",
  supportedInterfaces: [
    {
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      tenant: "",
      url: "https://example.invalid/a2a/json-rpc",
    },
  ],
  provider: undefined,
  version: "1.0.0",
  capabilities: { extensions: [], streaming: true },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/markdown"],
  skills: [],
  signatures: [],
};

function agentMessage(
  taskId: string,
  contextId: string,
  text?: string,
): Message {
  return {
    role: Role.ROLE_AGENT,
    parts: text
      ? [
          {
            content: { $case: "text", value: text },
            filename: "",
            mediaType: "text/plain",
            metadata: {},
          },
        ]
      : [],
    messageId: crypto.randomUUID(),
    taskId,
    contextId,
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };
}

function artifact(
  step: NonNullable<LoadedScenario["steps"][number]["artifact"]>,
): Artifact {
  return {
    artifactId: step.artifactId,
    name: step.name ?? "",
    description: step.description ?? "",
    parts: step.parts.map((part) => ({
      content: { $case: "text", value: part.text ?? "" },
      filename: "",
      mediaType: "text/plain",
      metadata: {},
    })),
    metadata: step.metadata ?? {},
    extensions: [],
  };
}

type ScenarioSession = {
  canceled: boolean;
  contextId: string;
  invokerId: string;
  nextStep: number;
  scenario: LoadedScenario;
  sessionId: string;
  status?: TaskStatus;
  taskId: string;
  tenantId: string;
};

function createAgentExecutor(
  scenarios: LoadedScenario[],
  diagnostics: Diagnostics,
): AgentExecutor {
  const sessions = new Map<string, ScenarioSession>();

  return {
    async execute(requestContext, eventBus) {
      const { taskId, contextId, task, userMessage } = requestContext;
      const existing = sessions.get(taskId);
      const invocationContext = invocationContextFromParts(userMessage.parts);
      const selection = selectScenarioWithDiagnostic(
        scenarios,
        invocationContext,
      );
      const scenario = existing?.scenario ?? selection.scenario;
      const session = existing ?? {
        canceled: false,
        contextId,
        invokerId: invocationContext.invokerId,
        nextStep: 0,
        scenario,
        sessionId: crypto.randomUUID(),
        taskId,
        tenantId: invocationContext.tenantId,
      };
      sessions.set(taskId, session);
      diagnostics({
        event: "scenario-selected",
        taskId: session.taskId,
        contextId: session.contextId,
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        invokerId: session.invokerId,
        scenarioId: scenario.id,
        selection: existing ? "resume" : selection.category,
        workItemAvailability: invocationContext.workItem.availability,
        commentAvailability: invocationContext.comment.availability,
        callbackReadiness: scenario.steps.some(
          (step) => step.event === "jira-callback",
        )
          ? "simulated"
          : "not-configured",
      });

      for (
        let index = session.nextStep;
        index < scenario.steps.length;
        index++
      ) {
        const step = scenario.steps[index];
        if (!step) return;
        if (step.delayMs)
          await new Promise((resolve) => setTimeout(resolve, step.delayMs));
        if (session.canceled) return;
        session.nextStep = index + 1;

        if (step.event === "artifact-update" && step.artifact) {
          eventBus.publish(
            AgentEvent.artifactUpdate({
              taskId,
              contextId,
              artifact: artifact(step.artifact),
              append: step.append === true,
              lastChunk: step.lastChunk === true,
              metadata: {},
            }),
          );
          continue;
        }
        if (step.event === "jira-callback" && step.action) {
          const contextUnavailable =
            invocationContext.workItem.availability !== "available" ||
            !session.tenantId ||
            !session.invokerId;
          const result = contextUnavailable
            ? "context-unavailable"
            : (step.result ?? "simulated");
          const state =
            result === "auth-required"
              ? TaskState.TASK_STATE_AUTH_REQUIRED
              : result === "rejected"
                ? TaskState.TASK_STATE_REJECTED
                : result === "failed"
                  ? TaskState.TASK_STATE_FAILED
                  : (session.status?.state ?? TaskState.TASK_STATE_WORKING);
          const message =
            step.message ??
            (result === "context-unavailable"
              ? "Simulated Jira callback skipped because the active invocation context is unavailable; no Jira action was performed."
              : `Simulated Jira ${step.action} callback (${result}); no Jira action was performed.`);
          const status = {
            state,
            message: agentMessage(taskId, contextId, message),
            timestamp: new Date().toISOString(),
          };
          session.status = status;
          diagnostics({
            event: "jira-callback",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            invokerId: session.invokerId,
            ...(invocationContext.workItem.id
              ? { workItemId: invocationContext.workItem.id }
              : {}),
            scenarioId: scenario.id,
            action: step.action,
            result,
          });
          if (index === 0) {
            eventBus.publish(
              AgentEvent.task(
                task
                  ? { ...task, status }
                  : {
                      id: taskId,
                      contextId,
                      artifacts: [],
                      history: [],
                      metadata: {},
                      status,
                    },
              ),
            );
          } else {
            eventBus.publish(
              AgentEvent.statusUpdate({
                taskId,
                contextId,
                status,
                metadata: {},
              }),
            );
          }
          if (result === "auth-required") return;
          if (["rejected", "failed"].includes(result)) {
            sessions.delete(taskId);
            return;
          }
          continue;
        }
        if (step.event !== "status-update") {
          diagnostics({
            event: "compliance-warning",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            warning: "unsupported-scenario-event",
          });
          continue;
        }
        const state = step.state
          ? taskStates[step.state]
          : session.status?.state;
        if (!state) {
          diagnostics({
            event: "compliance-warning",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            warning: "unsupported-task-state",
          });
          continue;
        }
        const status = {
          state,
          message: agentMessage(taskId, contextId, step.message),
          timestamp: new Date().toISOString(),
        };
        session.status = status;
        diagnostics({
          event: "lifecycle",
          taskId: session.taskId,
          contextId: session.contextId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          scenarioId: scenario.id,
          state: step.state ?? "unknown",
        });
        if (index === 0) {
          eventBus.publish(
            AgentEvent.task(
              task
                ? { ...task, status }
                : {
                    id: taskId,
                    contextId,
                    artifacts: [],
                    history: [],
                    metadata: {},
                    status,
                  },
            ),
          );
        } else {
          eventBus.publish(
            AgentEvent.statusUpdate({
              taskId,
              contextId,
              status,
              metadata: {},
            }),
          );
        }
        if (step.waitForUserInput) {
          diagnostics({
            event: "paused",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            state: step.state ?? "unknown",
          });
          return;
        }
        if (
          [
            TaskState.TASK_STATE_COMPLETED,
            TaskState.TASK_STATE_REJECTED,
            TaskState.TASK_STATE_FAILED,
            TaskState.TASK_STATE_CANCELED,
          ].includes(state)
        ) {
          sessions.delete(taskId);
          return;
        }
      }
    },
    async cancelTask(taskId, eventBus) {
      const session = sessions.get(taskId);
      if (!session || session.canceled) return;
      session.canceled = true;
      const contextId = session.status?.message?.contextId ?? "";
      diagnostics({
        event: "canceled",
        taskId: session.taskId,
        contextId: session.contextId,
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        scenarioId: session.scenario.id,
      });
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: agentMessage(taskId, contextId, "Task canceled."),
            timestamp: new Date().toISOString(),
          },
          metadata: {},
        }),
      );
    },
  };
}

export function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  diagnostics,
  jwksUrl = ATLASSIAN_FORGE_JWKS_URL,
  scenarios,
}: ServerOptions = {}): Result<Express, ProblemDetails> {
  if (!appAri) {
    return StandardError.getOrDefault(500).error("FORGE_APP_ID is required");
  }

  let loadedScenarios: LoadedScenario[];
  try {
    loadedScenarios = scenarios
      ? validateScenarios(scenarios)
      : loadScenarios();
  } catch (error) {
    return StandardError.getOrDefault(400).error(
      error instanceof Error ? error.message : "Invalid scenario collection",
    );
  }

  const reportDiagnostics =
    diagnostics ??
    ((event: DiagnosticEvent) => log.info(event, "[A2A] diagnostic"));
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    createAgentExecutor(loadedScenarios, reportDiagnostics),
  );
  const app = express();
  app.use((request, _, next) => {
    log.info(
      { method: request.method, path: request.path },
      "[HTTP] request received",
    );
    next();
  });
  app.use(
    "/a2a/json-rpc",
    (_, __, next) => {
      log.info("[Forge Remote/FIT] invocation token validation started");
      next();
    },
    forgeRemoteAuthMiddleware({
      audience: appAri,
      issuer: "forge/invocation-token",
      jwksUrl,
    }),
    (_, __, next) => {
      log.info("[Forge Remote/FIT] invocation token validated");
      next();
    },
    (_, __, next) => {
      log.info("[JSON-RPC] request dispatched to A2A handler");
      next();
    },
    jsonRpcHandler({
      requestHandler,
      userBuilder: forgeRemoteUserBuilder,
      contextBuilder: forgeRemoteServerCallContextBuilder(),
    }),
  );
  app.use((request, response) => {
    log.warn(
      { method: request.method, path: request.path },
      "[HTTP] request rejected: no matching route",
    );
    response.status(404).end();
  });

  return ok(app);
}
