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
