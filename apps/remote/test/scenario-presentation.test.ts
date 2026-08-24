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
    checkpoint[0],
    {
      event: "status-update",
      state: "input-required",
      message: "# Markdown showcase\n\nReply `Continue` for the next example.",
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

test("publishes a polling conclusion before terminal completion", () => {
  const steps: ScenarioStep[] = [
    { event: "status-update", state: "working", message: "Implementing" },
    {
      event: "status-update",
      state: "completed",
      message: "Review [PR #42](https://example.test/pr/42).",
      final: true,
      showConclusionBeforeCompletion: true,
    },
  ];

  assert.deepEqual(projectScenarioSteps(steps, "polling"), [
    steps[0],
    {
      event: "status-update",
      state: "working",
      message: "Review [PR #42](https://example.test/pr/42).",
    },
    {
      event: "status-update",
      state: "completed",
      message: "Review [PR #42](https://example.test/pr/42).",
      final: true,
      showConclusionBeforeCompletion: true,
    },
  ]);
});

test("terminates final artifact Markdown chunks for every transport", () => {
  const steps: ScenarioStep[] = [
    {
      event: "artifact-update",
      lastChunk: true,
      artifact: {
        artifactId: "patch",
        parts: [{ text: "```diff\n+const ready = true;\n```" }],
      },
    },
  ];

  for (const transport of ["polling", "streaming"] as const) {
    const projected = projectScenarioSteps(steps, transport);
    assert.equal(
      projected[0]?.artifact?.parts[0]?.text,
      "```diff\n+const ready = true;\n```\n\n",
    );
  }
  assert.equal(
    steps[0]?.artifact?.parts[0]?.text,
    "```diff\n+const ready = true;\n```",
  );
});
