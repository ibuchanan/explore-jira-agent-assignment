/**
 * Remote agent manifest contract tests
 *
 * These tests encode the externally documented Forge/Rovo contract for this
 * sample: Jira reaches the agent through a rovo:agentConnector using a declared
 * JSON-RPC endpoint, and installation lifecycle events are delivered directly to
 * a Forge Remote endpoint.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/|Integrate remote agents with Jira}
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/|Rovo agent connector module}
 * @see {@link https://developer.atlassian.com/platform/forge/remote/essentials/#remote-contract|Forge Remote invocation contract}
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/endpoint/|Endpoint module}
 */

import { describe, expect, it } from "vitest";
import { getManifestScopes, loadManifest } from "./manifest-helpers";

type EndpointModule = {
  key: string;
  remote: string;
  route?: { path?: string };
  auth?: {
    appSystemToken?: { enabled?: boolean };
    appUserToken?: { enabled?: boolean };
  };
};

type RemoteModule = {
  key: string;
  baseUrl?: string;
  operations?: string[];
  auth?: {
    appSystemToken?: { enabled?: boolean };
    appUserToken?: { enabled?: boolean };
  };
};

type AgentConnectorModule = {
  key: string;
  name: string;
  productContexts?: string[];
  protocols?: {
    agent2Agent?: {
      jsonRpcTransport?: {
        endpoint?: string;
        streaming?: boolean;
      };
    };
  };
};

type EndpointTriggerModule = {
  key: string;
  endpoint?: string;
  function?: string;
  events?: string[];
};

type RemoteAgentManifest = ReturnType<typeof loadManifest> & {
  modules: ReturnType<typeof loadManifest>["modules"] & {
    endpoint?: EndpointModule[];
    "rovo:agentConnector"?: AgentConnectorModule[];
    trigger?: EndpointTriggerModule[];
  };
  remotes?: RemoteModule[];
};

function getRemoteAgentManifest(): RemoteAgentManifest {
  return loadManifest() as RemoteAgentManifest;
}

function endpointByKey(
  manifest: RemoteAgentManifest,
): Map<string, EndpointModule> {
  return new Map(
    (manifest.modules.endpoint ?? []).map((endpoint) => [
      endpoint.key,
      endpoint,
    ]),
  );
}

function remoteByKey(manifest: RemoteAgentManifest): Map<string, RemoteModule> {
  return new Map(
    (manifest.remotes ?? []).map((remote) => [remote.key, remote]),
  );
}

describe("Remote agent manifest contract", () => {
  it("declares a Jira Rovo agent connector backed by the JSON-RPC endpoint", () => {
    const manifest = getRemoteAgentManifest();
    const connectors = manifest.modules["rovo:agentConnector"] ?? [];

    expect(connectors).toHaveLength(1);
    const connector = connectors[0];

    expect(connector).toMatchObject({
      key: "jira-agent-connector",
      productContexts: ["jira"],
    });
    expect(connector.name.length).toBeLessThanOrEqual(30);

    const transport = connector.protocols?.agent2Agent?.jsonRpcTransport;
    expect(transport).toMatchObject({ endpoint: "a2a-json-rpc-endpoint" });
    expect(transport?.streaming ?? false).toBe(true);
    expect(endpointByKey(manifest).has(transport?.endpoint ?? "")).toBe(true);
  });

  it("routes all declared remote endpoints to an existing remote and absolute path", () => {
    const manifest = getRemoteAgentManifest();
    const remotes = remoteByKey(manifest);
    const endpoints = manifest.modules.endpoint ?? [];

    expect(endpoints.length).toBeGreaterThan(0);

    const violations = endpoints.flatMap((endpoint) => {
      const errors: string[] = [];
      if (!remotes.has(endpoint.remote)) {
        errors.push(
          `${endpoint.key} references missing remote ${endpoint.remote}`,
        );
      }
      if (!endpoint.route?.path?.startsWith("/")) {
        errors.push(`${endpoint.key} route path must start with /`);
      }
      return errors;
    });

    expect(
      violations,
      violations.length
        ? `Invalid remote endpoint wiring:\n${violations.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("keeps documented endpoint routes stable for Jira remote agent traffic", () => {
    const endpoints = endpointByKey(getRemoteAgentManifest());

    expect(endpoints.get("a2a-json-rpc-endpoint")?.route?.path).toBe(
      "/a2a/json-rpc",
    );
    expect(endpoints.get("atlassian-installed-endpoint")?.route?.path).toBe(
      "/atlassian/installed",
    );
    expect(endpoints.get("atlassian-config-endpoint")?.route?.path).toBe(
      "/atlassian/config",
    );
  });

  it("subscribes the installation lifecycle event directly to the remote installation endpoint", () => {
    const manifest = getRemoteAgentManifest();
    const installTrigger = (manifest.modules.trigger ?? []).find((trigger) =>
      trigger.events?.includes("avi:forge:installed:app"),
    );

    expect(installTrigger).toMatchObject({
      key: "installation-trigger",
      endpoint: "atlassian-installed-endpoint",
    });
    expect(installTrigger?.function).toBeUndefined();
    expect(endpointByKey(manifest).has(installTrigger?.endpoint ?? "")).toBe(
      true,
    );
  });

  it("declares token scopes required by the remote token configuration", () => {
    const manifest = getRemoteAgentManifest();
    const scopes = new Set(getManifestScopes(manifest));
    const remotes = manifest.remotes ?? [];

    expect(scopes.has("read:jira-work")).toBe(true);

    for (const remote of remotes) {
      if (remote.auth?.appSystemToken?.enabled) {
        expect(
          scopes.has("read:app-system-token"),
          `${remote.key} enables appSystemToken`,
        ).toBe(true);
      }
      if (remote.auth?.appUserToken?.enabled) {
        expect(
          scopes.has("read:app-user-token"),
          `${remote.key} enables appUserToken`,
        ).toBe(true);
      }
    }
  });

  it("declares remote compute and storage operations for the backend service", () => {
    const backend = remoteByKey(getRemoteAgentManifest()).get(
      "backend-service",
    );
    const remoteServiceUrlVariable = "$" + "{REMOTE_SERVICE_URL}";

    expect(backend?.baseUrl).toBe(remoteServiceUrlVariable);
    expect(backend?.operations).toEqual(
      expect.arrayContaining(["compute", "storage"]),
    );
  });
});
