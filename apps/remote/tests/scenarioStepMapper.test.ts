/**
 * Simulation Scenario step mapping tests.
 */

import { describe, expect, it } from "vitest";
import type { ScenarioStep } from "../src/scenarios.js";
import { mapScenarioStep } from "../src/scenarioStepMapper.js";

describe("mapScenarioStep", () => {
  it("maps a status-update step with an explicit state to a task-state-update event", () => {
    const step: ScenarioStep = {
      event: "status-update",
      state: "working",
      message: "Starting work",
    };

    expect(mapScenarioStep(step)).toEqual({
      kind: "task-state-update",
      state: "working",
      final: false,
      message: "Starting work",
    });
  });

  it("maps a status-update step without a state to a content-update event", () => {
    const step: ScenarioStep = {
      event: "status-update",
      message: "Looking into the details...",
    };

    expect(mapScenarioStep(step)).toEqual({
      kind: "content-update",
      message: "Looking into the details...",
    });
  });

  it("maps an artifact-update step to an artifact-update event", () => {
    const step: ScenarioStep = {
      event: "artifact-update",
      artifact: { artifactId: "patch-1", name: "patch.diff" },
    };

    expect(mapScenarioStep(step)).toEqual({
      kind: "artifact-update",
      artifact: { artifactId: "patch-1", name: "patch.diff" },
    });
  });

  it("maps an artifact-update step's append and lastChunk fields onto the mapped event", () => {
    const step: ScenarioStep = {
      event: "artifact-update",
      artifact: { artifactId: "patch-1", name: "patch.diff" },
      append: true,
      lastChunk: false,
    };

    expect(mapScenarioStep(step)).toEqual({
      kind: "artifact-update",
      artifact: { artifactId: "patch-1", name: "patch.diff" },
      append: true,
      lastChunk: false,
    });
  });
});
