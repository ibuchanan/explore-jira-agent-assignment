import assert from "node:assert/strict";
import test from "node:test";

import { TaskState } from "@a2a-js/sdk";
import { createScenarioRunner } from "../src/scenario-runner.js";
import { loadScenarios, type LoadedScenario } from "../src/scenarios.js";

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
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  assert.equal(messageFromEvent(events[1]), "Progress\n\nContinue");
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

test("plays the rich simulated coding-agent lifecycle", async () => {
  const scenario = loadScenarios().find(
    ({ id }) => id === "coding-agent-happy-path",
  );
  assert.ok(scenario);

  const runner = createScenarioRunner({
    scenarios: [
      {
        ...scenario,
        default: false,
        steps: scenario.steps.map((step) => ({ ...step, delayMs: 0 })),
      },
      {
        id: "fallback",
        default: true,
        match: { contains: [] },
        steps: [{ event: "status-update", state: "completed" }],
      },
    ],
  });
  const events: unknown[] = [];
  const eventBus = { publish: (event: unknown) => events.push(event) };
  const requestContext = {
    context: {
      comment: { availability: "missing" },
      entrySurface: "issue-panel",
      invokerId: "user-1",
      tenantId: "tenant-1",
      text: "fix the login bug",
      workItem: { availability: "missing", fields: {} },
    },
    contextId: "context-1",
    taskId: "task-1",
    userMessage: { parts: [{ text: "fix the login bug" }] },
  };

  await runner.execute(requestContext as never, eventBus as never);

  assert.equal(
    stateFromEvent(events.at(-1)),
    TaskState.TASK_STATE_INPUT_REQUIRED,
  );
  assert.match(JSON.stringify(events), /### Goal/);

  await runner.execute(
    {
      ...requestContext,
      userMessage: { parts: [{ text: "Approve delivery plan" }] },
    } as never,
    eventBus as never,
  );

  assert.equal(
    stateFromEvent(events.at(-1)),
    TaskState.TASK_STATE_INPUT_REQUIRED,
  );
  assert.match(JSON.stringify(events), /### Evidence/);
  const secondApprovalEventCount = events.length;

  await runner.execute(
    {
      ...requestContext,
      userMessage: { parts: [{ text: "Approve technical approach" }] },
    } as never,
    eventBus as never,
  );

  assert.equal(stateFromEvent(events.at(-1)), TaskState.TASK_STATE_COMPLETED);
  const resumedStates = events
    .slice(secondApprovalEventCount)
    .map(stateFromEvent)
    .filter((state): state is TaskState => state !== undefined);
  assert.equal(resumedStates[0], TaskState.TASK_STATE_WORKING);
  assert.ok(!resumedStates.includes(TaskState.TASK_STATE_INPUT_REQUIRED));

  const delivered = JSON.stringify(events);
  assert.match(delivered, /supabase\/supabase#48329/);
  for (const artifact of [
    "implementation-patch-1",
    "verification-report-1",
    "review-handoff-1",
  ]) {
    assert.match(delivered, new RegExp(artifact));
  }
});
