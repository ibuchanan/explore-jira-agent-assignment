/**
 * Forge Remote installation lifecycle endpoint tests
 *
 * These tests complement the lifecycle and remote invocation docs by specifying
 * how the sample backend verifies Forge Invocation Tokens, extracts the site
 * context ARI, resolves Jira server information, and stores installation data.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/life-cycle/|Forge lifecycle events}
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import installationWebhook from "./data/installation-webhook.json";

const validateAuthHeader = vi.fn();
const saveData = vi.fn();
const fetchJiraServerInfo = vi.fn();

vi.mock("forge-ahead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("forge-ahead")>();
  return {
    ...actual,
    validateAuthHeader,
  };
});

vi.mock("../src/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/storage.js")>();
  return {
    ...actual,
    saveData,
  };
});

const { app } = await import("../src/server.js");
const { installations } = await import("../src/storage.js");

const cloudId = "89a6b224-3b44-4cef-8e4d-37aff29af277";
const baseUrl = "https://example.atlassian.net";
const realFetch = globalThis.fetch;

async function postInstallation(
  body: unknown,
  options: { authorization?: string } = { authorization: "Bearer test-fit" },
): Promise<Response> {
  const { createServer } = await import("node:http");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start test server");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }

  try {
    return await fetch(`http://127.0.0.1:${address.port}/atlassian/installed`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

describe("Installation lifecycle remote endpoint contract", () => {
  beforeEach(() => {
    installations.clear();
    saveData.mockClear();
    fetchJiraServerInfo.mockReset();
    fetchJiraServerInfo.mockResolvedValue(
      Response.json({ baseUrl }, { status: 200 }),
    );
    validateAuthHeader.mockReset();
    validateAuthHeader.mockResolvedValue({
      isErr: () => false,
      value: { context: { cloudId, moduleKey: "installation-trigger" } },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.startsWith("http://127.0.0.1:")) {
          return realFetch(input, init);
        }
        return fetchJiraServerInfo(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores tenant installation details from a valid Forge installed event", async () => {
    const response = await postInstallation(installationWebhook);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(fetchJiraServerInfo).toHaveBeenCalledWith(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/serverInfo`,
      undefined,
    );
    expect(saveData).toHaveBeenCalledTimes(1);
    expect(installations.get(cloudId)).toMatchObject({
      cloudId,
      installationId: installationWebhook.id,
      installerAccountId: installationWebhook.installerAccountId,
      baseUrl,
    });
    expect(installations.get(cloudId)?.installedAt).toEqual(expect.any(String));
  });

  it("rejects installation requests without a lifecycle event id", async () => {
    const { id: _id, ...eventWithoutId } = installationWebhook;

    const response = await postInstallation(eventWithoutId);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing installation id",
    });
    expect(fetchJiraServerInfo).not.toHaveBeenCalled();
    expect(installations.size).toBe(0);
    expect(saveData).not.toHaveBeenCalled();
  });

  it("rejects installation requests without a Forge Invocation Token", async () => {
    const response = await postInstallation(installationWebhook, {
      authorization: undefined,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Missing or invalid authorization header",
    });
    expect(installations.size).toBe(0);
    expect(saveData).not.toHaveBeenCalled();
  });

  it("rejects invalid installation context ARIs before fetching Jira server info", async () => {
    const response = await postInstallation({
      ...installationWebhook,
      context: "ari:cloud:jira::site/not-a-uuid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid context ARI format",
    });
    expect(fetchJiraServerInfo).not.toHaveBeenCalled();
    expect(installations.size).toBe(0);
    expect(saveData).not.toHaveBeenCalled();
  });

  it("returns a predictable failure when Jira server info cannot be resolved", async () => {
    fetchJiraServerInfo.mockRejectedValueOnce(new Error("network unavailable"));

    const response = await postInstallation(installationWebhook);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to process installation",
    });
    expect(installations.size).toBe(0);
    expect(saveData).not.toHaveBeenCalled();
  });
});
