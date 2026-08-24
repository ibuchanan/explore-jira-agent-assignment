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
