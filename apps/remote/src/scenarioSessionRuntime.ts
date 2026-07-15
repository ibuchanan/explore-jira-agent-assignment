/**
 * Imperative shell for Simulation Scenario Sessions.
 *
 * The pure core in scenarioSession.ts returns value effects. This shell
 * applies those effects to task/context storage, timers, and active streams.
 */

import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "@forge-ahead/errors";
import {
  isTerminalState,
  isValidTransition,
  type MappedEvent,
} from "forge-ahead";
import type { AgentContext, Task } from "./storage.js";
import type { Scenario } from "./scenarios.js";
import {
  cancelActiveSimulationScenarioSession,
  completeInactiveCancellation,
  type SessionEffect,
  requestInactiveCancellation,
  resubscribeSimulationScenarioSession,
  resumeSimulationScenarioSession,
  startSimulationScenarioSession,
  tickSimulationScenarioSession,
} from "./scenarioSession.js";

export interface SimulationScenarioSessionStore {
  getTask: (taskId: string) => Task | undefined;
  setTask: (task: Task) => void;
  save: () => void;
}

export interface SimulationScenarioSessionStream {
  emit: (event: MappedEvent, task: Task) => void;
  close: () => void;
}

export interface SimulationScenarioSessionRuntimeOptions {
  store: SimulationScenarioSessionStore;
  setTimer?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  cancellationStopDelayMs: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface PreparedSessionContinuation {
  effects: SessionEffect[];
}

interface ActiveSession {
  task: Task;
  context: AgentContext;
  scenario: Scenario;
  stream: SimulationScenarioSessionStream;
  timer?: ReturnType<typeof setTimeout>;
}

export function prefixAgentMessage(message: string): string {
  return `🤖 ${message}`;
}

export class SimulationScenarioSessionRuntime {
  private readonly activeSessions = new Map<string, ActiveSession>();
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(
    private readonly options: SimulationScenarioSessionRuntimeOptions,
  ) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(
    task: Task,
    context: AgentContext,
    scenario: Scenario,
  ): PreparedSessionContinuation {
    this.options.store.setTask(task);
    this.options.store.save();
    return this.prepareAfterSnapshot(
      task,
      context,
      startSimulationScenarioSession({ scenario }),
    );
  }

  resume(
    task: Task,
    context: AgentContext,
    scenario: Scenario,
  ): PreparedSessionContinuation {
    return this.prepareAfterSnapshot(
      task,
      context,
      resumeSimulationScenarioSession({
        scenario,
        nextStepIndex: task.nextStepIndex ?? 0,
      }),
    );
  }

  resubscribe(task: Task, scenario: Scenario): PreparedSessionContinuation {
    return {
      effects: resubscribeSimulationScenarioSession({
        scenario,
        taskState: task.status.state,
        nextStepIndex: task.nextStepIndex ?? 0,
      }),
    };
  }

  attachStream(
    task: Task,
    context: AgentContext,
    scenario: Scenario,
    stream: SimulationScenarioSessionStream,
    continuation: PreparedSessionContinuation,
  ): void {
    this.stopActiveSession(task.id);
    const activeSession: ActiveSession = {
      task,
      context,
      scenario,
      stream,
    };
    this.activeSessions.set(task.id, activeSession);
    this.applyEffectsToActiveSession(activeSession, continuation.effects);
  }

  cancel(taskId: string): Result<Task, ProblemDetails> {
    const task = this.options.store.getTask(taskId);
    if (!task) {
      return StandardError.getOrDefault(404).error("Task not found");
    }

    if (!isValidTransition(task.status.state, "canceled")) {
      return StandardError.getOrDefault(409).error(
        "Task cannot be canceled from current state",
      );
    }

    const activeSession = this.activeSessions.get(taskId);
    if (activeSession) {
      this.clearActiveTimer(activeSession);
      this.activeSessions.delete(taskId);
      this.applyEffectsToActiveSession(
        activeSession,
        cancelActiveSimulationScenarioSession(),
      );
      return ok(task);
    }

    this.applyEffectsToTask(
      task,
      undefined,
      requestInactiveCancellation({
        stopDelayMs: this.options.cancellationStopDelayMs,
      }),
      undefined,
    );
    this.options.log?.("Task cancellation requested:", {
      taskId,
      fromState: task.status.state,
    });
    return ok(task);
  }

  private prepareAfterSnapshot(
    task: Task,
    context: AgentContext,
    effects: SessionEffect[],
  ): PreparedSessionContinuation {
    const afterSnapshot: SessionEffect[] = [];
    for (const effect of effects) {
      if (
        (effect.kind === "apply-step" || effect.kind === "apply-event") &&
        !effect.emit
      ) {
        this.applyEffectsToTask(task, context, [effect], undefined);
      } else {
        afterSnapshot.push(effect);
      }
    }
    return { effects: afterSnapshot };
  }

  private applyEffectsToActiveSession(
    activeSession: ActiveSession,
    effects: SessionEffect[],
  ): void {
    this.applyEffectsToTask(
      activeSession.task,
      activeSession.context,
      effects,
      activeSession,
    );
  }

  private applyEffectsToTask(
    task: Task,
    context: AgentContext | undefined,
    effects: SessionEffect[],
    activeSession: ActiveSession | undefined,
  ): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "apply-step":
          task.nextStepIndex = effect.stepIndex + 1;
          this.applyMappedEventToTask(effect.event, task, context);
          if (effect.emit) {
            activeSession?.stream.emit(effect.event, task);
          }
          break;
        case "apply-event":
          this.applyMappedEventToTask(effect.event, task, context);
          if (effect.emit) {
            activeSession?.stream.emit(effect.event, task);
          }
          break;
        case "schedule-step":
          if (activeSession) {
            this.scheduleStep(activeSession, effect.stepIndex, effect.delayMs);
          }
          break;
        case "schedule-cancellation-stop":
          this.scheduleCancellationStop(task.id, effect.delayMs);
          break;
        case "close-stream":
          if (activeSession) {
            this.activeSessions.delete(activeSession.task.id);
            this.clearActiveTimer(activeSession);
            activeSession.stream.close();
          }
          break;
      }
    }
  }

  private applyMappedEventToTask(
    event: MappedEvent,
    task: Task,
    context: AgentContext | undefined,
  ): void {
    const now = new Date().toISOString();

    if (event.kind === "task-state-update") {
      task.status.state = event.state;
    }
    task.status.timestamp = now;

    if (event.kind !== "artifact-update" && event.message) {
      const text = prefixAgentMessage(event.message);
      task.status.message.parts = [{ kind: "text", text }];
      context?.messages.push({ role: "agent", text, timestamp: now });
    }

    this.options.store.save();
  }

  private scheduleStep(
    activeSession: ActiveSession,
    stepIndex: number,
    delayMs: number,
  ): void {
    this.clearActiveTimer(activeSession);
    activeSession.timer = this.setTimer(() => {
      const current = this.activeSessions.get(activeSession.task.id);
      if (!current) {
        return;
      }
      this.applyEffectsToActiveSession(
        current,
        tickSimulationScenarioSession({
          scenario: current.scenario,
          stepIndex,
        }),
      );
    }, delayMs);
  }

  private scheduleCancellationStop(taskId: string, delayMs: number): void {
    this.setTimer(() => {
      const task = this.options.store.getTask(taskId);
      if (!task || isTerminalState(task.status.state)) {
        return;
      }

      this.applyEffectsToTask(
        task,
        undefined,
        completeInactiveCancellation(),
        undefined,
      );

      this.options.log?.("Task transitioned:", {
        taskId,
        toState: "canceled",
      });
    }, delayMs);
  }

  private stopActiveSession(taskId: string): void {
    const activeSession = this.activeSessions.get(taskId);
    if (!activeSession) {
      return;
    }

    this.clearActiveTimer(activeSession);
    this.activeSessions.delete(taskId);
    activeSession.stream.close();
  }

  private clearActiveTimer(activeSession: ActiveSession): void {
    if (activeSession.timer) {
      this.clearTimer(activeSession.timer);
      activeSession.timer = undefined;
    }
  }
}
