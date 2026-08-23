import {
  createPublicKey,
  randomUUID,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

const DEFAULT_JWKS_URL =
  "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";

type JsonRpcId = string | number;
type RecordValue = Record<string, unknown>;
type JwtHeader = { alg?: unknown; kid?: unknown };
type FitClaims = { aud?: unknown; exp?: unknown; iss?: unknown };
type JsonRpcRequest = {
  id?: unknown;
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
};
type JsonRpcParameters = { message?: unknown };
type A2aMessage = { contextId?: unknown };
type StatusError = { statusCode?: unknown };

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

function decode(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

async function verifyFit(
  token: string,
  { appAri, jwksUrl }: Required<Pick<ServerOptions, "appAri" | "jwksUrl">>,
) {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] =
    token.split(".");
  if (extra.length || !encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("FIT must be a three-part JWT");
  }

  const headerValue = decode(encodedHeader);
  if (!isRecord(headerValue)) {
    throw new Error("FIT header must be an object");
  }
  const header = headerValue as JwtHeader;
  if (header.alg !== "ES256" && header.alg !== "RS256") {
    throw new Error(
      `unsupported FIT signing algorithm: ${header.alg != null ? String(header.alg) : "missing"}`,
    );
  }
  if (typeof header.kid !== "string") {
    throw new Error("FIT is missing a signing key ID");
  }

  const jwks = (await (await fetch(jwksUrl)).json()) as {
    keys?: Array<JsonWebKey & { kid?: unknown }>;
  };
  const jwk = jwks.keys?.find(
    (key) =>
      key.kid === header.kid &&
      (header.alg === "ES256"
        ? key.kty === "EC" && key.crv === "P-256"
        : key.kty === "RSA"),
  );
  if (!jwk) throw new Error("unknown signing key");

  const signedContent = Buffer.from(`${encodedHeader}.${encodedPayload}`);
  const publicKey = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  const signature = Buffer.from(encodedSignature, "base64url");
  const validSignature =
    header.alg === "ES256"
      ? verify(
          "sha256",
          signedContent,
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          signature,
        )
      : verify("RSA-SHA256", signedContent, publicKey, signature);
  if (!validSignature) throw new Error("invalid signature");

  const claimsValue = decode(encodedPayload);
  if (!isRecord(claimsValue)) {
    throw new Error("FIT claims must be an object");
  }
  const claims = claimsValue as FitClaims;
  if (
    claims.iss !== "forge/invocation-token" ||
    !(
      claims.aud === appAri ||
      (Array.isArray(claims.aud) && claims.aud.includes(appAri))
    )
  ) {
    const error = Object.assign(new Error("forbidden token"), {
      statusCode: 403,
    });
    throw error;
  }
  if (typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000) {
    throw new Error("expired token");
  }
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
    try {
      await verifyFit(authorization.slice("Bearer ".length), {
        appAri,
        jwksUrl,
      });
    } catch (error) {
      console.warn(
        `A2A FIT rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      const statusCode = isRecord(error)
        ? (error as StatusError).statusCode
        : undefined;
      response
        .writeHead(typeof statusCode === "number" ? statusCode : 401)
        .end();
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

    const taskId = randomUUID();
    const requestedContextId = message.contextId;
    const contextId =
      typeof requestedContextId === "string" && requestedContextId.trim()
        ? requestedContextId
        : randomUUID();
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
              messageId: randomUUID(),
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
