import { validateAuthHeader } from "@forge-ahead/remote";
import { createServer, type IncomingMessage, type Server } from "node:http";

const DEFAULT_JWKS_URL =
  "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";

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

function json(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: unknown,
) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function protocolError(
  response: import("node:http").ServerResponse,
  id: JsonRpcId | null,
  code: number,
  message: string,
) {
  json(response, 400, { jsonrpc: "2.0", id, error: { code, message } });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  jwksUrl = DEFAULT_JWKS_URL,
}: ServerOptions = {}): Server {
  if (!appAri) throw new Error("FORGE_APP_ID is required");

  return createServer(async (request, response) => {
    console.info("A2A request received");
    if (request.method !== "POST" || request.url !== "/a2a/json-rpc") {
      console.warn("A2A request rejected: unexpected HTTP method or path");
      response.writeHead(404).end();
      return;
    }
    if (
      !request.headers["content-type"]
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      response.writeHead(415).end();
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      console.warn("A2A request rejected: missing bearer token");
      response.writeHead(401).end();
      return;
    }
    const fit = await validateAuthHeader({
      authorization,
      audience: appAri,
      jwksUrl,
    });
    if (fit.isErr()) {
      console.warn(`A2A FIT rejected: ${fit.error.title}`);
      response.writeHead(fit.error.status ?? 401).end();
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      console.warn("A2A request rejected: invalid JSON body");
      protocolError(response, null, -32600, "Invalid Request");
      return;
    }
    if (!isRecord(body)) {
      console.warn("A2A request rejected: invalid JSON-RPC envelope");
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
      console.warn("A2A request rejected: invalid JSON-RPC envelope");
      protocolError(
        response,
        typeof id === "string" || typeof id === "number" ? id : null,
        -32600,
        "Invalid Request",
      );
      return;
    }
    if (method !== "SendMessage") {
      console.warn(`A2A method not supported: ${method}`);
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
    console.info("A2A SendMessage completed");
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
  });
}
