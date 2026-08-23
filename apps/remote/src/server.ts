import { type AgentCard, Role, TaskState } from "@a2a-js/sdk";
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
  capabilities: { extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/markdown"],
  skills: [],
  signatures: [],
};

function createAgentExecutor(scenarios: LoadedScenario[]): AgentExecutor {
  return {
    async execute({ taskId, contextId, userMessage }, eventBus) {
      const startingText = textParts(userMessage.parts);
      const scenario = selectScenario(scenarios, startingText);
      const matched = scenario.match.contains.some((phrase) =>
        startingText.toLowerCase().includes(phrase.toLowerCase()),
      );
      log.info(
        {
          taskId,
          contextId,
          scenarioId: scenario.id,
          selection: matched ? "match" : "default",
        },
        "[A2A] executing scenario",
      );

      for (const step of scenario.steps) {
        if (step.event === "content-update" || !step.state) continue;
        if (step.event !== "status-update") {
          log.warn(
            { taskId, contextId, scenarioId: scenario.id },
            "[A2A] Compliance Warning: unsupported scenario event",
          );
          continue;
        }
        const state = taskStates[step.state];
        if (!state) {
          log.warn(
            { taskId, contextId, scenarioId: scenario.id, state: step.state },
            "[A2A] Compliance Warning: unsupported task state",
          );
          continue;
        }
        eventBus.publish(
          AgentEvent.task({
            id: taskId,
            contextId,
            artifacts: [],
            history: [],
            metadata: {},
            status: {
              state,
              message: {
                role: Role.ROLE_AGENT,
                parts: step.message
                  ? [
                      {
                        content: { $case: "text", value: step.message },
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
              },
              timestamp: new Date().toISOString(),
            },
          }),
        );
      }
    },
    async cancelTask() {},
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
