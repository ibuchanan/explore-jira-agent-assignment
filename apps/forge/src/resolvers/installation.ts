/**
 * Installation webhook handler for Remote Agent
 *
 * Handles the avi:forge:installed:app trigger event when the Forge app is installed
 * into a Jira site. This webhook forwards the installation details to the remote
 * service for persistence and tenant mapping.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/|Forge events reference}
 */

import { route } from "@forge/api";
import {
  getAuthForEvent,
  type InstallationEvent,
  type JSONValue,
  logContext,
  logResult,
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
  validateAuthHeader,
} from "forge-ahead";

/**
 * Fetches Jira site base URL using the correct auth strategy for the event
 * @param event - The installation event (used to select auth strategy via getAuthForEvent)
 * @returns Result<string, ProblemDetails> - Ok(baseUrl) or Err with status and detail
 */
export async function fetchJiraBaseUrl(
  event: InstallationEvent,
): Promise<Result<string, ProblemDetails>> {
  try {
    const response = await getAuthForEvent(event).requestJira(
      route`/rest/api/3/serverInfo`,
    );
    if (!response.ok) {
      return StandardError.getOrDefault(response.status).error(
        `Failed to fetch server info: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { baseUrl: string };
    return ok(data.baseUrl);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unexpected error fetching Jira base URL";
    console.error("Error fetching Jira base URL:", error);
    return StandardError.getOrDefault(500).error(detail);
  }
}

/**
 * Handles the installation event
 * This is called by the Forge trigger when the app is installed
 *
 * @param event - Installation event payload
 * @param context - Forge invocation context (contains tokens, etc.)
 */
export async function installationHandler(
  event: InstallationEvent,
  context?: { headers?: Record<string, string> },
): Promise<void> {
  console.log("Installation event received:", {
    eventType: event.eventType,
    installationId: event.id,
  });
  logContext(event.context as JSONValue, "Installation");

  // Get cloudId from event context
  const cloudId = event.context.cloudId;

  // Optionally verify the FIT token if needed
  // In trigger functions, Forge handles auth automatically
  // but if forwarding to remote service, you may want to validate
  const authHeader = context?.headers?.authorization;
  if (authHeader) {
    const result = await validateAuthHeader(authHeader);
    if (result.isErr()) {
      console.warn(
        "Installation event received with invalid token:",
        result.error.detail,
      );
    } else {
      console.debug("Token validated for app:", result.value.aud);
    }
  }

  // Fetch the base URL for the Jira site using the correct auth strategy
  const baseUrlResult = await fetchJiraBaseUrl(event);
  if (baseUrlResult.isErr()) {
    logResult(baseUrlResult, "Fetch Jira base URL");
    return;
  }

  // Log the installation details
  console.log("Installation details:", {
    cloudId,
    installationId: event.id,
    baseUrl: baseUrlResult.value,
    installerAccountId: event.installerAccountId,
    appVersion: event.app.version,
  });

  // TODO: Forward to remote service
  // In a complete implementation, this would call the remote service's
  // /atlassian/installed endpoint with the installation details
  // The remote service would then persist this in its database

  console.log("Installation processed successfully");
}
