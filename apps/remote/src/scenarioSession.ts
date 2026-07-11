/**
 * Sans-IO Simulation Scenario Session core.
 *
 * This module owns task-local Simulation Scenario Session policy without
 * touching storage, timers, logging, or SSE. Callers apply the returned
 * effects in an imperative shell.
 */

import { isTerminalState, type MappedEvent, type TaskState } from "forge-ahead";
import type { Scenario, ScenarioStep } from "./scenarios.js";
import { mapScenarioStep } from "./scenarioStepMapper.js";

export type SessionEffect =
  | {
      kind: "apply-step";
      stepIndex: number;
      event: MappedEvent;
      emit: boolean;
    }
  | {
      kind: "apply-event";
      event: MappedEvent;
      emit: boolean;
    }
  | {
      kind: "schedule-step";
      stepIndex: number;
      delayMs: number;
    }
  | {
      kind: "schedule-cancellation-stop";
      delayMs: number;
    }
  | {
      kind: "close-stream";
      reason: "complete" | "paused" | "no-steps";
    };

export interface SessionStartInput {
  scenario: Scenario;
  nextStepIndex?: number;
}

export interface SessionTickInput {
  scenario: Scenario;
  stepIndex: number;
}

export interface SessionResubscribeInput {
  scenario: Scenario;
  taskState: TaskState;
  nextStepIndex?: number;
}

export interface SessionCancelInput {
  stopDelayMs: number;
}

function scheduleOrClose(scenario: Scenario, stepIndex: number): SessionEffect {
  const step = scenario.steps[stepIndex];
  if (!step) {
    return { kind: "close-stream", reason: "no-steps" };
  }
  return {
    kind: "schedule-step",
    stepIndex,
    delayMs: step.delayMs ?? 0,
  };
}

function closeReasonForStep(step: ScenarioStep): "complete" | "paused" {
  return step.final ? "complete" : "paused";
}

function foldLeadingStep({
  scenario,
  nextStepIndex = 0,
}: SessionStartInput): SessionEffect[] {
  const step = scenario.steps[nextStepIndex];
  if (!step) {
    return [{ kind: "close-stream", reason: "no-steps" }];
  }

  const event = mapScenarioStep(step);
  if (event.kind === "artifact-update") {
    return [scheduleOrClose(scenario, nextStepIndex)];
  }

  const effects: SessionEffect[] = [
    {
      kind: "apply-step",
      stepIndex: nextStepIndex,
      event,
      emit: false,
    },
  ];

  if (step.final || step.waitForUserInput) {
    effects.push({
      kind: "close-stream",
      reason: closeReasonForStep(step),
    });
    return effects;
  }

  effects.push(scheduleOrClose(scenario, nextStepIndex + 1));
  return effects;
}

export function startSimulationScenarioSession(
  input: SessionStartInput,
): SessionEffect[] {
  return foldLeadingStep(input);
}

export function resumeSimulationScenarioSession(
  input: SessionStartInput,
): SessionEffect[] {
  return foldLeadingStep(input);
}

export function tickSimulationScenarioSession({
  scenario,
  stepIndex,
}: SessionTickInput): SessionEffect[] {
  const step = scenario.steps[stepIndex];
  if (!step) {
    return [{ kind: "close-stream", reason: "no-steps" }];
  }

  const event = mapScenarioStep(step);
  const effects: SessionEffect[] = [
    {
      kind: "apply-step",
      stepIndex,
      event,
      emit: true,
    },
  ];

  if (step.final || step.waitForUserInput) {
    effects.push({
      kind: "close-stream",
      reason: closeReasonForStep(step),
    });
    return effects;
  }

  effects.push(scheduleOrClose(scenario, stepIndex + 1));
  return effects;
}

export function resubscribeSimulationScenarioSession({
  scenario,
  taskState,
  nextStepIndex = 0,
}: SessionResubscribeInput): SessionEffect[] {
  if (isTerminalState(taskState) || isResumableTaskState(taskState)) {
    return [{ kind: "close-stream", reason: "paused" }];
  }
  return [scheduleOrClose(scenario, nextStepIndex)];
}

export function isResumableTaskState(state: TaskState): boolean {
  return state === "auth-required" || state === "input-required";
}

export function cancelActiveSimulationScenarioSession(): SessionEffect[] {
  return [
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
  ];
}

export function requestInactiveCancellation({
  stopDelayMs,
}: SessionCancelInput): SessionEffect[] {
  return [
    {
      kind: "apply-event",
      event: {
        kind: "content-update",
        message: "Canceling...",
      },
      emit: false,
    },
    { kind: "schedule-cancellation-stop", delayMs: stopDelayMs },
  ];
}

export function completeInactiveCancellation(): SessionEffect[] {
  return [
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
  ];
}
