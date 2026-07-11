/**
 * Simulation Scenario Session pure-core tests.
 *
 * These tests exercise the sans-IO session policy directly: no Express,
 * no storage, no timers, and no real time.
 */

import { describe, expect, it } from "vitest";
import type { Scenario } from "../src/scenarios.js";
import {
  cancelActiveSimulationScenarioSession,
  completeInactiveCancellation,
  requestInactiveCancellation,
  resubscribeSimulationScenarioSession,
  resumeSimulationScenarioSession,
  startSimulationScenarioSession,
  tickSimulationScenarioSession,
} from "../src/scenarioSession.js";

const scenario: Scenario = {
  id: "session-core-test",
  steps: [
    {
      event: "status-update",
      state: "working",
      message: "Starting.",
    },
    {
      event: "status-update",
      message: "Doing the work.",
      delayMs: 25,
    },
    {
      event: "status-update",
      state: "auth-required",
      message: "Approval required.",
      waitForUserInput: true,
      delayMs: 50,
    },
    {
      event: "status-update",
      state: "working",
      message: "Resuming.",
      delayMs: 10,
    },
    {
      event: "status-update",
      state: "completed",
      message: "Done.",
      final: true,
      delayMs: 5,
    },
  ],
};

describe("Simulation Scenario Session core", () => {
  it("start folds the leading state and schedules the next step by delay", () => {
    expect(startSimulationScenarioSession({ scenario })).toEqual([
      {
        kind: "apply-step",
        stepIndex: 0,
        event: {
          kind: "task-state-update",
          state: "working",
          final: false,
          message: "Starting.",
        },
        emit: false,
      },
      {
        kind: "schedule-step",
        stepIndex: 1,
        delayMs: 25,
      },
    ]);
  });

  it("tick emits the next event, advances by step index, and schedules more work", () => {
    expect(tickSimulationScenarioSession({ scenario, stepIndex: 1 })).toEqual([
      {
        kind: "apply-step",
        stepIndex: 1,
        event: {
          kind: "content-update",
          message: "Doing the work.",
        },
        emit: true,
      },
      {
        kind: "schedule-step",
        stepIndex: 2,
        delayMs: 50,
      },
    ]);
  });

  it("tick closes instead of scheduling after a pause step", () => {
    expect(tickSimulationScenarioSession({ scenario, stepIndex: 2 })).toEqual([
      {
        kind: "apply-step",
        stepIndex: 2,
        event: {
          kind: "task-state-update",
          state: "auth-required",
          final: false,
          message: "Approval required.",
        },
        emit: true,
      },
      { kind: "close-stream", reason: "paused" },
    ]);
  });

  it("resume folds from the stored nextStepIndex and schedules from there", () => {
    expect(
      resumeSimulationScenarioSession({ scenario, nextStepIndex: 3 }),
    ).toEqual([
      {
        kind: "apply-step",
        stepIndex: 3,
        event: {
          kind: "task-state-update",
          state: "working",
          final: false,
          message: "Resuming.",
        },
        emit: false,
      },
      {
        kind: "schedule-step",
        stepIndex: 4,
        delayMs: 5,
      },
    ]);
  });

  it("resubscribe does not continue paused or terminal tasks", () => {
    expect(
      resubscribeSimulationScenarioSession({
        scenario,
        taskState: "auth-required",
        nextStepIndex: 3,
      }),
    ).toEqual([{ kind: "close-stream", reason: "paused" }]);

    expect(
      resubscribeSimulationScenarioSession({
        scenario,
        taskState: "completed",
        nextStepIndex: 5,
      }),
    ).toEqual([{ kind: "close-stream", reason: "paused" }]);
  });

  it("resubscribe schedules active tasks from their stored cursor", () => {
    expect(
      resubscribeSimulationScenarioSession({
        scenario,
        taskState: "working",
        nextStepIndex: 4,
      }),
    ).toEqual([
      {
        kind: "schedule-step",
        stepIndex: 4,
        delayMs: 5,
      },
    ]);
  });

  it("active cancellation emits cancellation progress, terminal canceled, and close", () => {
    expect(cancelActiveSimulationScenarioSession()).toEqual([
      {
        kind: "apply-event",
        event: {
          kind: "content-update",
          message: "Canceling...",
        },
        emit: true,
      },
      {
        kind: "apply-event",
        event: {
          kind: "task-state-update",
          state: "canceled",
          final: true,
          message: "This task has been canceled.",
        },
        emit: true,
      },
      { kind: "close-stream", reason: "complete" },
    ]);
  });

  it("inactive cancellation separates progress from scheduled terminal stop", () => {
    expect(requestInactiveCancellation({ stopDelayMs: 50 })).toEqual([
      {
        kind: "apply-event",
        event: {
          kind: "content-update",
          message: "Canceling...",
        },
        emit: false,
      },
      { kind: "schedule-cancellation-stop", delayMs: 50 },
    ]);

    expect(completeInactiveCancellation()).toEqual([
      {
        kind: "apply-event",
        event: {
          kind: "task-state-update",
          state: "canceled",
          final: true,
          message: "This task has been canceled.",
        },
        emit: false,
      },
    ]);
  });
});
