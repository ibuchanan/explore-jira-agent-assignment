/**
 * Simulation Scenario step mapping.
 *
 * Converts Simulation Scenario steps (already A2A-shaped: `event`, `state`,
 * `final`, `message`, `artifact`) into the same provider-neutral `MappedEvent`
 * shape used by the Remote Agent Signal mapper.
 */

import type { Artifact, MappedEvent, TaskState } from "forge-ahead";
import type { ScenarioStep } from "./scenarios.js";

export function mapScenarioStep(step: ScenarioStep): MappedEvent {
  if (step.event === "artifact-update") {
    return {
      kind: "artifact-update",
      artifact: step.artifact as unknown as Artifact,
      ...(step.append !== undefined && { append: step.append }),
      ...(step.lastChunk !== undefined && { lastChunk: step.lastChunk }),
    };
  }

  if (step.state === undefined) {
    return { kind: "content-update", message: step.message ?? "" };
  }

  return {
    kind: "task-state-update",
    state: step.state as TaskState,
    final: step.final ?? false,
    message: step.message,
  };
}
