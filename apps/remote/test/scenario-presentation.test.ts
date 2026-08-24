import assert from "node:assert/strict";
import test from "node:test";

import { projectScenarioSteps } from "../src/scenario-presentation.js";
import type { ScenarioStep } from "../src/scenarios.js";

const checkpoint: ScenarioStep[] = [
  {
    event: "status-update",
    state: "working",
    message: "# Markdown showcase",
  },
  {
    event: "status-update",
    state: "input-required",
    message: "Reply `Continue` for the next example.",
    waitForUserInput: true,
  },
];

test("coalesces a transient working checkpoint for polling", () => {
  assert.deepEqual(projectScenarioSteps(checkpoint, "polling"), [
    {
      event: "status-update",
      state: "input-required",
      message:
        "# Markdown showcase\n\nReply `Continue` for the next example.",
      waitForUserInput: true,
    },
  ]);
});

test("preserves a working checkpoint for streaming", () => {
  assert.deepEqual(projectScenarioSteps(checkpoint, "streaming"), checkpoint);
});

test("does not coalesce a non-pausing state transition for polling", () => {
  const steps: ScenarioStep[] = [
    { event: "status-update", state: "working", message: "Working" },
    { event: "status-update", state: "auth-required", message: "Sign in" },
  ];

  assert.deepEqual(projectScenarioSteps(steps, "polling"), steps);
});
