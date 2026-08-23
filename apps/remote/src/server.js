const { createPublicKey, randomUUID, verify } = require("node:crypto");
const { createServer } = require("node:http");

const DEFAULT_JWKS_URL =
  "https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json";
function json(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function protocolError(response, id, code, message) {
  json(response, 400, { jsonrpc: "2.0", id, error: { code, message } });
}

function decode(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

async function verifyFit(token, { appAri, jwksUrl }) {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] =
    token.split(".");
  if (extra.length || !encodedHeader || !encodedPayload || !encodedSignature)
    throw new Error("FIT must be a three-part JWT");

  const header = decode(encodedHeader);
  if (!["ES256", "RS256"].includes(header.alg))
    throw new Error(
      `unsupported FIT signing algorithm: ${header.alg ?? "missing"}`,
    );
  if (typeof header.kid !== "string")
    throw new Error("FIT is missing a signing key ID");

  const { keys } = await (await fetch(jwksUrl)).json();
  const jwk = keys?.find(
    (key) =>
      key.kid === header.kid &&
      (header.alg === "ES256"
        ? key.kty === "EC" && key.crv === "P-256"
        : key.kty === "RSA"),
  );
  if (!jwk) throw new Error("unknown signing key");

  const signedContent = Buffer.from(`${encodedHeader}.${encodedPayload}`);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
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

  const claims = decode(encodedPayload);
  if (
    claims.iss !== "forge/invocation-token" ||
    !(claims.aud === appAri || claims.aud?.includes?.(appAri))
  ) {
    const error = new Error("forbidden token");
    error.statusCode = 403;
    throw error;
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000)
    throw new Error("expired token");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function createA2aServer({
  appId = process.env.FORGE_APP_ID,
  appAri = appId && `ari:cloud:ecosystem::app/${appId}`,
  jwksUrl = DEFAULT_JWKS_URL,
} = {}) {
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
      console.warn(`A2A FIT rejected: ${error.message}`);
      response.writeHead(error.statusCode ?? 401).end();
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      console.warn("A2A request rejected: invalid JSON body");
      protocolError(response, null, -32600, "Invalid Request");
      return;
    }
    if (
      body?.jsonrpc !== "2.0" ||
      !(typeof body.id === "string" || typeof body.id === "number") ||
      typeof body.method !== "string"
    ) {
      console.warn("A2A request rejected: invalid JSON-RPC envelope");
      protocolError(response, body?.id ?? null, -32600, "Invalid Request");
      return;
    }
    if (body.method !== "SendMessage") {
      console.warn(`A2A method not supported: ${body.method}`);
      json(response, 200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    if (!body.params?.message || typeof body.params.message !== "object") {
      protocolError(response, body.id, -32600, "Invalid Request");
      return;
    }

    const taskId = randomUUID();
    const requestedContextId = body.params.message.contextId;
    const contextId =
      typeof requestedContextId === "string" && requestedContextId.trim()
        ? requestedContextId
        : randomUUID();
    console.info("A2A SendMessage completed");
    json(response, 200, {
      jsonrpc: "2.0",
      id: body.id,
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

module.exports = { createA2aServer };
