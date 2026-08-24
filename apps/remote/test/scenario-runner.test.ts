import assert from "node:assert/strict";
import test from "node:test";

import { TaskState } from "@a2a-js/sdk";
import { createScenarioRunner } from "../src/scenario-runner.js";
import type { LoadedScenario } from "../src/scenarios.js";

function stateFromEvent(event: unknown): TaskState | undefined {
  if (!event || typeof event !== "object") return undefined;
  return (event as { data?: { status?: { state?: TaskState } } }).data?.status
    ?.state;
}

function messageFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const parts = (event as { data?: { status?: { message?: { parts?: unknown[] } } } })
    .data?.status?.message?.parts;
  const first = parts?.[0] as { content?: { value?: unknown } } | undefined;
  return typeof first?.content?.value === "string"
    ? first.content.value
    : undefined;
}

test("starts a new session after a terminal transition", async () => {
  const events: unknown[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const runner = createScenarioRunner({
    diagnostics: (event) => diagnostics.push(event),
    scenarios: [
      {
        id: "terminal",
        default: true,
        match: { contains: [] },
        steps: [
          { event: "status-update", state: "working" },
          { event: "status-update", state: "completed" },
        ],
      },
    ],
  });
  const eventBus = { publish: (event: unknown) => events.push(event) };
  const requestContext = {
    context: {},
    contextId: "context-1",
    taskId: "task-1",
    userMessage: { parts: [] },
  };

  await runner.execute(requestContext as never, eventBus as never);
  await runner.execute(requestContext as never, eventBus as never);

  assert.deepEqual(events.map(stateFromEvent), [
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  const sessions = diagnostics
    .filter((event) => event.event === "scenario-selected")
    .map((event) => event.sessionId);
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0], sessions[1]);
});

test("freezes steps when creating a paused task", async () => {
  const events: unknown[] = [];
  let steps: LoadedScenario["steps"] = [
    {
      event: "status-update",
      state: "input-required",
      waitForUserInput: true,
    },
    { event: "status-update", state: "working", message: "before edit" },
    { event: "status-update", state: "completed" },
  ];
  const runner = createScenarioRunner({
    scenarios: [
      {
        id: "reloaded",
        default: true,
        match: { contains: [] },
        steps: [{ event: "status-update", state: "completed" }],
      },
    ],
    loadSteps: () => steps,
  });
  const eventBus = { publish: (event: unknown) => events.push(event) };
  const requestContext = {
    context: {},
    contextId: "context-1",
    taskId: "task-1",
    userMessage: { parts: [] },
  };

  await runner.execute(requestContext as never, eventBus as never);
  steps = [
    { event: "status-update", state: "input-required", waitForUserInput: true },
    { event: "status-update", state: "working", message: "after edit" },
    { event: "status-update", state: "completed" },
  ];
  await runner.execute(requestContext as never, eventBus as never);

  assert.deepEqual(events.map(stateFromEvent), [
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  assert.equal(messageFromEvent(events[1]), "before edit");
});

test("freezes the polling projection when creating a task", async () => {
  const events: unknown[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  let transport: "polling" | "streaming" = "polling";
  const runner = createScenarioRunner({
    diagnostics: (event) => diagnostics.push(event),
    scenarios: [
      {
        id: "checkpoint",
        default: true,
        match: { contains: [] },
        steps: [
          { event: "status-update", state: "working", message: "Progress" },
          {
            event: "status-update",
            state: "input-required",
            message: "Continue",
            waitForUserInput: true,
          },
          { event: "status-update", state: "completed" },
        ],
      },
    ],
    transport: () => transport,
  });
  const eventBus = { publish: (event: unknown) => events.push(event) };
  const requestContext = {
    context: {},
    contextId: "context-1",
    taskId: "task-1",
    userMessage: { parts: [] },
  };

  await runner.execute(requestContext as never, eventBus as never);
  transport = "streaming";
  await runner.execute(requestContext as never, eventBus as never);

  assert.deepEqual(events.map(stateFromEvent), [
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  assert.equal(messageFromEvent(events[0]), "Progress\n\nContinue");
  assert.deepEqual(
    diagnostics.find((event) => event.event === "scenario.transport.mismatch"),
    {
      event: "scenario.transport.mismatch",
      requestedTransport: "streaming",
      taskId: "task-1",
      transport: "polling",
    },
  );
});

test("resumes a paused scenario with working before completion", async () => {
  const events: unknown[] = [];
  const scenarios: LoadedScenario[] = [
    {
      id: "paused",
      default: true,
      match: { contains: [] },
      steps: [
        {
          event: "status-update",
          state: "input-required",
          waitForUserInput: true,
        },
        { event: "status-update", state: "working" },
        { event: "status-update", state: "completed" },
      ],
    },
  ];
  const runner = createScenarioRunner({ scenarios });
  const eventBus = { publish: (event: unknown) => events.push(event) };
  const requestContext = {
    context: {},
    contextId: "context-1",
    taskId: "task-1",
    userMessage: { parts: [] },
  };

  await runner.execute(requestContext as never, eventBus as never);
  await runner.execute(requestContext as never, eventBus as never);

  assert.deepEqual(events.map(stateFromEvent), [
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
});
