import type { AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { jsonRpcHandler } from "@a2a-js/sdk/server/express";
import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "@forge-ahead/errors";
import { log } from "@forge-ahead/logging";
import { ATLASSIAN_FORGE_JWKS_URL } from "@forge-ahead/remote";
import type { ForgeRemoteRequest } from "@forge-ahead/remote/express";
import {
  forgeRemoteAuthMiddleware,
  forgeRemoteServerCallContextBuilder,
  forgeRemoteUserBuilder,
} from "@forge-ahead/remote/express";
import {
  createRemoteAuthAcceptedRecord,
  emitRemoteLogRecord,
  type RemoteLogRecordLogger,
} from "@forge-ahead/remote/logging";
import express, { type Express } from "express";
import {
  createScenarioRunner,
  type Delay,
  type DiagnosticEvent,
  type Diagnostics,
} from "./scenario-runner.js";
import {
  type LoadedScenario,
  loadScenarios,
  validateScenarios,
} from "./scenarios.js";

type ServerOptions = {
  appAri?: string;
  appId?: string;
  delay?: Delay;
  diagnostics?: Diagnostics;
  enableRealJiraCallbacks?: boolean;
  jiraFetch?: typeof fetch;
  jwksUrl?: string;
  remoteLogger?: RemoteLogRecordLogger;
  scenarios?: LoadedScenario[];
};

const remoteLogger: RemoteLogRecordLogger = {
  debug: (record) => log.debug({ ...record }, record.message),
  info: (record) => log.info({ ...record }, record.message),
  warn: (record) => log.warn({ ...record }, record.message),
  error: (record) => log.error({ ...record }, record.message),
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

export function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  diagnostics,
  enableRealJiraCallbacks = process.env
    .ENABLE_REAL_JIRA_CALLBACK_SMOKE_TESTS === "true",
  jiraFetch = fetch,
  jwksUrl = ATLASSIAN_FORGE_JWKS_URL,
  remoteLogger: configuredRemoteLogger = remoteLogger,
  scenarios,
}: ServerOptions = {}): Result<Express, ProblemDetails> {
  if (!appAri)
    return StandardError.getOrDefault(500).error("FORGE_APP_ID is required");

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
    createScenarioRunner({
      scenarios: loadedScenarios,
      diagnostics: reportDiagnostics,
      delay,
      enableRealJiraCallbacks,
      jiraFetch,
      remoteLogger: configuredRemoteLogger,
    }),
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
    (request, _, next) => {
      const remoteRequest = request as ForgeRemoteRequest;
      if (remoteRequest.forgeRemoteContext)
        emitRemoteLogRecord(
          configuredRemoteLogger,
          createRemoteAuthAcceptedRecord({
            context: remoteRequest.forgeRemoteContext,
          }),
        );
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
