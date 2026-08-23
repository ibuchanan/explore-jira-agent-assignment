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
  type LoadedScenario,
  loadScenarios,
  selectScenario,
  validateScenarios,
} from "./scenarios.js";

type ServerOptions = {
  appAri?: string;
  appId?: string;
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

function textParts(
  parts: { content?: { $case?: string; value?: unknown } | undefined }[],
) {
  return parts
    .flatMap(({ content }) =>
      content?.$case === "text" && typeof content.value === "string"
        ? [content.value]
        : [],
    )
    .join("\n");
}

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
  nextStep: number;
  scenario: LoadedScenario;
  status?: TaskStatus;
};

function createAgentExecutor(scenarios: LoadedScenario[]): AgentExecutor {
  const sessions = new Map<string, ScenarioSession>();

  return {
    async execute(requestContext, eventBus) {
      const { taskId, contextId, task, userMessage } = requestContext;
      const existing = sessions.get(taskId);
      const startingText = textParts(userMessage.parts);
      const scenario =
        existing?.scenario ?? selectScenario(scenarios, startingText);
      const session = existing ?? {
        canceled: false,
        nextStep: 0,
        scenario,
      };
      sessions.set(taskId, session);
      log.info(
        {
          taskId,
          contextId,
          scenarioId: scenario.id,
          selection: existing
            ? "resume"
            : scenario.match.contains.some((phrase) =>
                  startingText.toLowerCase().includes(phrase.toLowerCase()),
                )
              ? "match"
              : "default",
        },
        "[A2A] executing scenario",
      );

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
        if (step.event !== "status-update") {
          log.warn(
            { taskId, contextId, scenarioId: scenario.id },
            "[A2A] Compliance Warning: unsupported scenario event",
          );
          continue;
        }
        const state = step.state
          ? taskStates[step.state]
          : session.status?.state;
        if (!state) {
          log.warn(
            { taskId, contextId, scenarioId: scenario.id, state: step.state },
            "[A2A] Compliance Warning: unsupported task state",
          );
          continue;
        }
        const status = {
          state,
          message: agentMessage(taskId, contextId, step.message),
          timestamp: new Date().toISOString(),
        };
        session.status = status;
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
        if (step.waitForUserInput) return;
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

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    createAgentExecutor(loadedScenarios),
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
