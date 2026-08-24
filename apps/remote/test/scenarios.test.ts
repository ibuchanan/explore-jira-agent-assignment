import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bundledScenarioDirectory,
  invocationContextFromParts,
  loadScenarios,
  selectScenario,
} from "../src/scenarios.js";

test("resolves bundled scenarios from the remote package layout", () => {
  assert.equal(
    bundledScenarioDirectory(),
    resolve(dirname(fileURLToPath(import.meta.url)), "../scenarios"),
  );
});

test("loads the bundled scenario collection", () => {
  assert.ok(loadScenarios().length > 0);
});

test("normalizes Jira context from an A2A data part", () => {
  assert.deepEqual(
    invocationContextFromParts([
      { text: "Investigate this" },
      {
        data: {
          invocationContext: {
            workItem: { id: "PROJ-42", fields: { summary: "Login failure" } },
            comment: { id: "10001", body: "Needs approval" },
            entrySurface: "comment",
            tenantId: "tenant-1",
            invokerId: "user-1",
          },
        },
      },
    ]),
    {
      text: "Investigate this",
      workItem: {
        availability: "available",
        id: "PROJ-42",
        fields: { summary: "Login failure" },
      },
      comment: {
        availability: "available",
        id: "10001",
        body: "Needs approval",
      },
      entrySurface: "comment",
      tenantId: "tenant-1",
      invokerId: "user-1",
    },
  );
});

test("selects a scenario from an available Jira work-item identity", () => {
  const scenarios = [
    {
      id: "work-item",
      default: false,
      match: { contains: [], workItem: { id: "PROJ-42" } },
      steps: [{ event: "status-update", state: "completed" }],
    },
    {
      id: "default",
      default: true,
      match: { contains: [] },
      steps: [{ event: "status-update", state: "completed" }],
    },
  ];

  const selected = selectScenario(scenarios, {
    text: "Please investigate this.",
    workItem: {
      availability: "available",
      id: "PROJ-42",
      fields: {},
    },
    comment: { availability: "missing" },
    entrySurface: "issue-panel",
    tenantId: "tenant-1",
    invokerId: "user-1",
  });

  assert.equal(selected.id, "work-item");
});

test("selects a scenario from an available triggering-comment body", () => {
  const scenarios = [
    {
      id: "comment",
      default: false,
      match: { contains: [], comment: { body: "needs approval" } },
      steps: [{ event: "status-update", state: "completed" }],
    },
    {
      id: "default",
      default: true,
      match: { contains: [] },
      steps: [{ event: "status-update", state: "completed" }],
    },
  ];

  const selected = selectScenario(scenarios, {
    text: "Please investigate this.",
    workItem: { availability: "missing", fields: {} },
    comment: {
      availability: "available",
      id: "10001",
      body: "This needs approval before release.",
    },
    entrySurface: "comment",
    tenantId: "tenant-1",
    invokerId: "user-1",
  });

  assert.equal(selected.id, "comment");
});

test("selects every short trigger within a natural Jira summary", () => {
  const scenarios = loadScenarios();
  for (const [summary, id] of [
    [
      "Request the repository connection for the release automation.",
      "auth-required-connection-configuration",
    ],
    [
      "Start the repository migration after the readiness review.",
      "cancellation-during-work",
    ],
    [
      "Investigate the login fix in the session refresh flow.",
      "coding-agent-happy-path",
    ],
    [
      "For this experiment, reject now without processing the request.",
      "immediate-rejection",
    ],
    [
      "Wait for repository approval before beginning deployment.",
      "initial-auth-required-resumption",
    ],
    [
      "Confirm the target environment before the rollout.",
      "initial-input-required-resumption",
    ],
    [
      "Review the checkout criteria before implementation.",
      "input-required-clarification-resumption",
    ],
    [
      "Prepare a checkout rollout assessment before release.",
      "checkout-rollout-assessment",
    ],
    [
      "Exercise the jira callback auth path in this task.",
      "jira-callback-auth-required",
    ],
    [
      "Exercise the jira callback failed path in this task.",
      "jira-callback-failed",
    ],
    [
      "Exercise the jira callback rejected path in this task.",
      "jira-callback-rejected",
    ],
    [
      "Exercise the jira callbacks integration for this task.",
      "jira-callbacks",
    ],
    ["Please show markdown in the result.", "markdown-happy-path"],
    [
      "Prepare the maintenance change for archived reports this week.",
      "repository-access-revoked-failure",
    ],
    [
      "Review the legacy reports cleanup request.",
      "repository-access-unavailable-rejection",
    ],
  ] as const)
    assert.equal(selectScenario(scenarios, summary).id, id, summary);
});
