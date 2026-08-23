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

type ServerOptions = {
  appAri?: string;
  appId?: string;
  jwksUrl?: string;
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
  capabilities: { extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/markdown"],
  skills: [],
  signatures: [],
};

const agentExecutor: AgentExecutor = {
  async execute({ taskId, contextId }, eventBus) {
    log.info({ taskId, contextId }, "[A2A] executing task");
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        artifacts: [],
        history: [],
        metadata: {},
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: {
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: {
                  $case: "text",
                  value: `# Agent Simulator\n\n**Markdown is enabled.**\n\n- A list item\n- \`inline code\`\n\n<details>\n<summary>More details</summary>\n\nThis is collapsed supplemental content.\n</details>`,
                },
                filename: "",
                mediaType: "text/markdown",
                metadata: {},
              },
            ],
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
  },
  async cancelTask() {},
};

export function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  jwksUrl = ATLASSIAN_FORGE_JWKS_URL,
}: ServerOptions = {}): Result<Express, ProblemDetails> {
  if (!appAri) {
    return StandardError.getOrDefault(500).error("FORGE_APP_ID is required");
  }

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    agentExecutor,
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
