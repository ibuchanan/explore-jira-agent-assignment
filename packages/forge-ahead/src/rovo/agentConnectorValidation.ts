/**
 * Runtime validators for Jira remote-agent protocol envelopes.
 */

import { z } from "zod";
import type { StreamResponse } from "./a2aContract";
import type { AgentConnectorResponse } from "./agentConnectorMethods";

// Shape of a TaskArtifactUpdateEvent's artifact deep enough to catch the
// cases isValidStreamResponse must reject: missing parts, or append/lastChunk
// present with the wrong type. Everything else is passthrough; the A2A
// contract does not define a required artifact metadata schema.
const ArtifactUpdateEventShape = z
  .object({
    artifact: z.object({ parts: z.array(z.unknown()) }).loose(),
    append: z.boolean().optional(),
    lastChunk: z.boolean().optional(),
  })
  .loose();

// Each branch is `.strict()` so a StreamResponse with more than one variant
// key fails every branch, encoding "exactly one of task, statusUpdate,
// message, or artifactUpdate" as a union rather than manual key counting.
const StreamResponseSchema = z.union([
  z.object({ task: z.unknown() }).strict(),
  z.object({ statusUpdate: z.unknown() }).strict(),
  z.object({ message: z.unknown() }).strict(),
  z.object({ artifactUpdate: ArtifactUpdateEventShape }).strict(),
]);

/**
 * Validate that a value is a well-formed StreamResponse: exactly one of
 * `task`, `statusUpdate`, `message`, or `artifactUpdate` present.
 */
export function isValidStreamResponse(
  response: unknown,
): response is StreamResponse {
  return StreamResponseSchema.safeParse(response).success;
}

// `result`/`error` are intentionally loose objects, not a deep Task schema.
// This is a JSON-RPC envelope check, not a content validator for the result
// payload.
const AgentConnectorResponseSchema = z.union([
  z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]),
      result: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number()]),
      error: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

/**
 * Validation helper to check if a response is a valid AgentConnectorResponse.
 */
export function isValidAgentConnectorResponse(
  response: unknown,
): response is AgentConnectorResponse {
  return AgentConnectorResponseSchema.safeParse(response).success;
}
