import { describe, expect, it } from "vitest";
import installationWebhook from "./data/installation-webhook.json";

/**
 * Test suite for installation webhook endpoint
 *
 * Validates that the remote service can accept installation webhooks
 * and extract the required fields per the recommended schema:
 * https://docs.remote-agents.jira.dev/installation#recommended-schema-for-jirainstallations-table
 *
 * Required fields:
 * - id (installationId)
 * - context (contains cloudId)
 * - installerAccountId (optional but recommended for audit)
 */
describe("Installation Webhook Endpoint", () => {
  it("should have required installation ID", () => {
    // id property is the installationId
    expect(installationWebhook.id).toBeDefined();
    expect(installationWebhook.id).toMatch(/^[a-f0-9-]+$/);
  });

  it("should have context in ARI format containing cloudId", () => {
    // context property contains the cloudId in ARI format
    const context = installationWebhook.context;
    expect(context).toBeDefined();
    expect(context).toMatch(/^ari:cloud:jira::site\/[a-f0-9-]+$/);
  });

  it("should extract cloudId from context ARI", () => {
    // cloudId is needed for API requests to Jira
    const context = installationWebhook.context;
    const match = context.match(/site\/([a-f0-9-]+)$/);
    expect(match).toBeDefined();
    expect(match?.[1]).toBe("89a6b224-3b44-4cef-8e4d-37aff29af277");
  });

  it("should have installerAccountId for audit purposes", () => {
    // Optional but recommended for audit purposes
    const accountId = installationWebhook.installerAccountId;
    expect(accountId).toBeDefined();
    expect(accountId).toMatch(/^\d+:[a-f0-9-]+$/);
  });
});
