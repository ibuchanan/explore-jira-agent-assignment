import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "@forge-ahead/errors";
import { log } from "@forge-ahead/logging";
import {
  ATLASSIAN_FORGE_JWKS_URL,
  validateAuthHeader,
} from "@forge-ahead/remote";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Response,
} from "express";

type JsonRpcId = string | number;
type RecordValue = Record<string, unknown>;
type JsonRpcRequest = {
  id?: unknown;
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
};
type JsonRpcParameters = { message?: unknown };
type A2aMessage = { contextId?: unknown };

type ServerOptions = {
  appAri?: string;
  appId?: string;
  jwksUrl?: string;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function json(response: Response, statusCode: number, body: unknown) {
  response.status(statusCode).json(body);
}

function protocolError(
  response: Response,
  id: JsonRpcId | null,
  code: number,
  message: string,
) {
  json(response, 400, { jsonrpc: "2.0", id, error: { code, message } });
}

export function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  jwksUrl = ATLASSIAN_FORGE_JWKS_URL,
}: ServerOptions = {}): Result<Express, ProblemDetails> {
  if (!appAri) {
    return StandardError.getOrDefault(500).error("FORGE_APP_ID is required");
  }

  const app = express();
  app.use((_, __, next) => {
    log.info("A2A request received");
    next();
  });
  app.post(
    "/a2a/json-rpc",
    async (request, response, next) => {
      if (
        !request.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        response.status(415).end();
        return;
      }

      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        log.warn("A2A request rejected: missing bearer token");
        response.status(401).end();
        return;
      }
      const fit = await validateAuthHeader({
        authorization,
        audience: appAri,
        jwksUrl,
      });
      if (fit.isErr()) {
        log.warn("A2A FIT rejected");
        response.status(fit.error.status ?? 401).end();
        return;
      }
      next();
    },
    express.json(),
    (request, response) => {
      const body: unknown = request.body;
      if (!isRecord(body)) {
        log.warn("A2A request rejected: invalid JSON-RPC envelope");
        protocolError(response, null, -32600, "Invalid Request");
        return;
      }
      const rpc = body as JsonRpcRequest;
      const { id, jsonrpc, method } = rpc;
      if (
        jsonrpc !== "2.0" ||
        !(typeof id === "string" || typeof id === "number") ||
        typeof method !== "string"
      ) {
        log.warn("A2A request rejected: invalid JSON-RPC envelope");
        protocolError(
          response,
          typeof id === "string" || typeof id === "number" ? id : null,
          -32600,
          "Invalid Request",
        );
        return;
      }
      if (method !== "SendMessage") {
        log.warn("A2A method not supported");
        json(response, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
        return;
      }
      if (!isRecord(rpc.params)) {
        protocolError(response, id, -32600, "Invalid Request");
        return;
      }
      const params = rpc.params as JsonRpcParameters;
      if (!isRecord(params.message)) {
        protocolError(response, id, -32600, "Invalid Request");
        return;
      }
      const message = params.message as A2aMessage;

      const taskId = crypto.randomUUID();
      const requestedContextId = message.contextId;
      const contextId =
        typeof requestedContextId === "string" && requestedContextId.trim()
          ? requestedContextId
          : crypto.randomUUID();
      log.info("A2A SendMessage completed");
      json(response, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          task: {
            id: taskId,
            contextId,
            status: {
              state: "TASK_STATE_COMPLETED",
              message: {
                role: "ROLE_AGENT",
                parts: [{ text: "Minimal connector is working." }],
                messageId: crypto.randomUUID(),
                taskId,
                contextId,
              },
              timestamp: new Date().toISOString(),
            },
          },
        },
      });
    },
  );
  const invalidJson: ErrorRequestHandler = (error, _, response, next) => {
    if (error instanceof SyntaxError) {
      log.warn("A2A request rejected: invalid JSON body");
      protocolError(response, null, -32600, "Invalid Request");
      return;
    }
    next(error);
  };
  app.use(invalidJson);
  app.use((_, response) => {
    log.warn("A2A request rejected: unexpected HTTP method or path");
    response.status(404).end();
  });

  return ok(app);
}
