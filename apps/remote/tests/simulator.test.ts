/**
 * A2A Simulator scenario-step mapping and playback tests
 *
 * @see specs/tickets/04-scenario-driven-streaming.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioStep } from "../src/scenarios.js";
import { mapScenarioStep, runScenario } from "../src/simulator.js";

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
});

describe("runScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits each step's mapped event in scenario order", async () => {
    const steps: ScenarioStep[] = [
      { event: "status-update", state: "working", message: "Starting" },
      { event: "status-update", state: "completed", final: true },
    ];
    const onEvent = vi.fn();

    runScenario(steps, onEvent);
    await vi.runAllTimersAsync();

    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      {
        kind: "task-state-update",
        state: "working",
        final: false,
        message: "Starting",
      },
      steps[0],
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      {
        kind: "task-state-update",
        state: "completed",
        final: true,
        message: undefined,
      },
      steps[1],
    );
  });

  it("does not schedule a later step until its earlier step's delay has elapsed", async () => {
    const steps: ScenarioStep[] = [
      { event: "status-update", state: "working", delayMs: 100 },
      { event: "status-update", state: "completed", final: true, delayMs: 10 },
    ];
    const onEvent = vi.fn();

    runScenario(steps, onEvent);

    await vi.advanceTimersByTimeAsync(50);
    expect(onEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(onEvent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("stops after a final step and does not run remaining steps", async () => {
    const steps: ScenarioStep[] = [
      { event: "status-update", state: "rejected", final: true },
      { event: "status-update", state: "working" },
    ];
    const onEvent = vi.fn();

    runScenario(steps, onEvent);
    await vi.runAllTimersAsync();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      {
        kind: "task-state-update",
        state: "rejected",
        final: true,
        message: undefined,
      },
      steps[0],
    );
  });

  it("stops after a waitForUserInput step and does not run remaining steps", async () => {
    const steps: ScenarioStep[] = [
      {
        event: "status-update",
        state: "auth-required",
        waitForUserInput: true,
      },
      { event: "status-update", state: "working" },
    ];
    const onEvent = vi.fn();

    runScenario(steps, onEvent);
    await vi.runAllTimersAsync();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      {
        kind: "task-state-update",
        state: "auth-required",
        final: false,
        message: undefined,
      },
      steps[0],
    );
  });
});
