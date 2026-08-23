import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";

import { createA2aServer } from "../src/server";

type Algorithm = "ES256" | "RS256";
type Claims = Record<string, unknown>;
type RequestOptions = {
  body: string;
  contentType?: string;
  path?: string;
  token?: string;
};
type CompletedResponse = {
  result: {
    task: {
      contextId: string;
      id: string;
      status: {
        message: {
          contextId: string;
          messageId: string;
          parts: unknown[];
          role: string;
          taskId: string;
        };
        state: string;
        timestamp: string;
      };
    };
  };
};
type Fixture = {
  request(options: RequestOptions): Promise<Response>;
  token(claims?: Claims): string;
};

function base64url(value: string | object): string {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");
}

function signedFit(
  privateKey: KeyObject,
  payload: Claims,
  algorithm: Algorithm = "ES256",
): string {
  const header = base64url({ alg: algorithm, kid: "test-key", typ: "JWT" });
  const body = base64url(payload);
  const input = Buffer.from(`${header}.${body}`);
  const signature = (
    algorithm === "ES256"
      ? sign("sha256", input, { key: privateKey, dsaEncoding: "ieee-p1363" })
      : sign("RSA-SHA256", input, privateKey)
  ).toString("base64url");
  return `${header}.${body}.${signature}`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (
        (error as NodeJS.ErrnoException | undefined)?.code ===
        "ERR_SERVER_NOT_RUNNING"
      ) {
        resolve();
      } else if (error) {
        reject(error);
      } else {
        resolve();
      }
    }),
  );
}

async function createFixture(
  t: TestContext,
  {
    algorithm = "ES256",
    appAri = "app",
    appId,
  }: { algorithm?: Algorithm; appAri?: string; appId?: string } = {},
): Promise<Fixture> {
  const keyPair =
    algorithm === "ES256"
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const audience = appId ? `ari:cloud:ecosystem::app/${appId}` : appAri;
  const jwks = createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        keys: [
          {
            ...keyPair.publicKey.export({ format: "jwk" }),
            kid: "test-key",
            use: "sig",
            alg: algorithm,
          },
        ],
      }),
    );
  });
  const jwksUrl = `${await listen(jwks)}/jwks`;
  t.after(() => close(jwks));

  const app = createA2aServer(appId ? { appId, jwksUrl } : { appAri, jwksUrl });
  const baseUrl = await listen(app);
  t.after(() => close(app));

  return {
    token: (claims: Claims = {}) =>
      signedFit(
        keyPair.privateKey,
        {
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 60,
          iss: "forge/invocation-token",
          ...claims,
        },
        algorithm,
      ),
    request: ({
      token,
      body,
      path = "/a2a/json-rpc",
      contentType = "application/json",
    }: RequestOptions) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": contentType,
        },
        body,
      }),
  };
}

test("returns a completed deterministic task for a verified SendMessage request", async (t) => {
  const { request, token } = await createFixture(t, { appId: "test" });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "request-123",
      method: "SendMessage",
      params: {
        message: {
          contextId: "context-456",
          parts: [{ text: "do not echo this" }],
        },
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as CompletedResponse & {
    id: string;
    jsonrpc: string;
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "request-123");
  assert.equal(body.result.task.contextId, "context-456");
  assert.match(body.result.task.id, /^[0-9a-f-]{36}$/i);
  assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(body.result.task.status.message.parts, [
    { text: "Minimal connector is working." },
  ]);
  assert.equal(body.result.task.status.message.role, "ROLE_AGENT");
  assert.equal(body.result.task.status.message.taskId, body.result.task.id);
  assert.equal(body.result.task.status.message.contextId, "context-456");
  assert.match(body.result.task.status.message.messageId, /^[0-9a-f-]{36}$/i);
  assert.match(body.result.task.status.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("rejects a SendMessage request without a message", async (t) => {
  const { request, token } = await createFixture(t);
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "SendMessage",
      params: {},
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32600, message: "Invalid Request" },
  });
});

test("rejects invalid requests and reports unsupported methods", async (t) => {
  const { request, token } = await createFixture(t);
  const validRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: "id",
    method: "SendMessage",
    params: { message: {} },
  });

  assert.equal((await request({ body: "not json" })).status, 401);
  assert.equal(
    (await request({ token: "bad", body: validRequest })).status,
    401,
  );
  assert.equal(
    (await request({ token: token({ exp: 0 }), body: validRequest })).status,
    401,
  );
  assert.equal(
    (await request({ token: token({ iss: "wrong" }), body: validRequest }))
      .status,
    403,
  );
  assert.equal(
    (await request({ token: token({ aud: "wrong" }), body: validRequest }))
      .status,
    403,
  );
  assert.equal(
    (await request({ token: token(), body: validRequest, path: "/wrong" }))
      .status,
    404,
  );
  assert.equal(
    (
      await request({
        token: token(),
        body: validRequest,
        contentType: "text/plain",
      })
    ).status,
    415,
  );

  const malformed = await request({ token: token(), body: "not json" });
  assert.equal(malformed.status, 400);
  assert.equal(
    ((await malformed.json()) as { error: { code: number } }).error.code,
    -32600,
  );
  const unsupported = await request({
    token: token(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "CancelTask" }),
  });
  assert.equal(unsupported.status, 200);
  assert.deepEqual(await unsupported.json(), {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32601, message: "Method not found" },
  });
});

test("creates fresh task and message IDs without echoing caller data", async (t) => {
  const { request, token } = await createFixture(t);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: {
        contextId: "",
        parts: [{ data: { secret: "never return" } }],
      },
    },
  });
  const [first, second] = await Promise.all([
    request({ token: token(), body }).then(
      async (response) => (await response.json()) as CompletedResponse,
    ),
    request({ token: token(), body }).then(
      async (response) => (await response.json()) as CompletedResponse,
    ),
  ]);

  assert.notEqual(first.result.task.id, second.result.task.id);
  assert.notEqual(
    first.result.task.status.message.messageId,
    second.result.task.status.message.messageId,
  );
  assert.notEqual(first.result.task.contextId, second.result.task.contextId);
  assert.equal(JSON.stringify(first).includes("never return"), false);
});

test("accepts an RS256 Forge Invocation Token", async (t) => {
  const { request, token } = await createFixture(t, { algorithm: "RS256" });
  const response = await request({
    token: token(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: { message: {} },
    }),
  });

  assert.equal(response.status, 200);
});
