/**
 * Simulation Scenario loading and matching tests
 *
 * @see specs/tickets/03-scenario-loading-and-matching.md
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkComplianceWarnings,
  loadScenarios,
  matchScenario,
  type Scenario,
} from "../src/scenarios.js";

const testDir = "tests/tmp/scenarios";

function writeScenario(filename: string, content: string): void {
  fs.writeFileSync(path.join(testDir, filename), content);
}

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("loadScenarios", () => {
  it("loads a well-formed scenario file into a Scenario object", () => {
    writeScenario(
      "happy-path.yaml",
      `
id: happy-path
default: true
steps:
  - event: status-update
    state: working
    message: "Starting work"
  - event: status-update
    state: completed
    final: true
`,
    );

    const result = loadScenarios(testDir);

    expect(result.isOk()).toBe(true);
    expect(result.value).toEqual([
      {
        id: "happy-path",
        default: true,
        steps: [
          {
            event: "status-update",
            state: "working",
            message: "Starting work",
          },
          { event: "status-update", state: "completed", final: true },
        ],
      },
    ]);
  });

  it("returns a 400 Problem Details error for malformed scenario YAML", () => {
    writeScenario("broken.yaml", "this is not: [valid yaml");

    const result = loadScenarios(testDir);

    expect(result.isErr()).toBe(true);
    expect(result.error).toMatchObject({ status: 400 });
  });

  it("returns a 400 Problem Details error when a scenario is missing required structural fields", () => {
    writeScenario(
      "no-id.yaml",
      `
steps:
  - event: status-update
    state: working
`,
    );

    const result = loadScenarios(testDir);

    expect(result.isErr()).toBe(true);
    expect(result.error).toMatchObject({ status: 400 });
  });

  it("returns a 400 Problem Details error when a scenario has no steps", () => {
    writeScenario(
      "no-steps.yaml",
      `
id: empty
steps: []
`,
    );

    const result = loadScenarios(testDir);

    expect(result.isErr()).toBe(true);
    expect(result.error).toMatchObject({ status: 400 });
  });

  it("does not reject a scenario for unusual A2A or Jira semantics, but logs a Compliance Warning", () => {
    writeScenario(
      "unusual.yaml",
      `
id: unusual-client-test
steps:
  - event: status-update
    state: not-a-real-a2a-state
    final: true
    waitForUserInput: true
`,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = loadScenarios(testDir);

    expect(result.isOk()).toBe(true);
    expect(result.value[0].steps[0]).toMatchObject({
      state: "not-a-real-a2a-state",
      final: true,
      waitForUserInput: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Compliance Warning",
      expect.objectContaining({ status: 422 }),
    );

    warnSpy.mockRestore();
  });

  it("does not log a Compliance Warning for a fully A2A-compliant scenario", () => {
    writeScenario(
      "compliant.yaml",
      `
id: compliant
steps:
  - event: status-update
    state: working
  - event: status-update
    state: completed
    final: true
`,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = loadScenarios(testDir);

    expect(result.isOk()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("loadScenarios artifact/delayMs fields", () => {
  it("loads artifact and delayMs step fields", () => {
    writeScenario(
      "with-artifact.yaml",
      `
id: with-artifact
steps:
  - event: artifact-update
    delayMs: 250
    artifact:
      artifactId: patch-1
      name: patch.diff
`,
    );

    const result = loadScenarios(testDir);

    expect(result.isOk()).toBe(true);
    expect(result.value[0].steps[0]).toEqual({
      event: "artifact-update",
      delayMs: 250,
      artifact: { artifactId: "patch-1", name: "patch.diff" },
    });
  });
});

describe("checkComplianceWarnings", () => {
  it("warns with a 422 Problem Details entry for a step with an unrecognized A2A task state", () => {
    const scenario: Scenario = {
      id: "unusual-client-test",
      steps: [{ event: "status-update", state: "not-a-real-a2a-state" }],
    };

    const warnings = checkComplianceWarnings(scenario);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      status: 422,
      type: expect.stringContaining("a2a-protocol.org"),
      detail: expect.stringContaining("not-a-real-a2a-state"),
    });
    expect(warnings[0].timestamp).toBeDefined();
  });

  it("does not warn for a step using a recognized A2A task state", () => {
    const scenario: Scenario = {
      id: "happy-path",
      steps: [{ event: "status-update", state: "working" }],
    };

    expect(checkComplianceWarnings(scenario)).toEqual([]);
  });

  it("warns with a 422 Problem Details entry for a step with an unrecognized event type", () => {
    const scenario: Scenario = {
      id: "unusual-event-test",
      steps: [{ event: "not-a-real-event" }],
    };

    const warnings = checkComplianceWarnings(scenario);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      status: 422,
      type: expect.stringContaining("a2a-protocol.org"),
      detail: expect.stringContaining("not-a-real-event"),
    });
  });

  it("does not warn for a step using a recognized event type", () => {
    const scenario: Scenario = {
      id: "happy-path",
      steps: [{ event: "artifact-update" }],
    };

    expect(checkComplianceWarnings(scenario)).toEqual([]);
  });
});

describe("matchScenario", () => {
  const bugFixScenario: Scenario = {
    id: "bug-fix",
    match: { contains: ["fix the bug"] },
    steps: [{ event: "status-update", state: "working" }],
  };
  const featureScenario: Scenario = {
    id: "new-feature",
    match: { contains: ["add a feature"] },
    steps: [{ event: "status-update", state: "working" }],
  };

  it("matches the scenario whose contains phrase is found in the task text, case-insensitively", () => {
    const result = matchScenario(
      [bugFixScenario, featureScenario],
      "Please FIX THE BUG in checkout",
    );

    expect(result).toEqual({ scenario: bugFixScenario, matchedBy: "rule" });
  });

  it("picks the earlier scenario in order when more than one rule matches", () => {
    const taskText = "please fix the bug and add a feature";

    const firstOrder = matchScenario(
      [bugFixScenario, featureScenario],
      taskText,
    );
    const reversedOrder = matchScenario(
      [featureScenario, bugFixScenario],
      taskText,
    );

    expect(firstOrder.scenario.id).toBe("bug-fix");
    expect(reversedOrder.scenario.id).toBe("new-feature");
  });

  it("falls back to the Default Scenario when no rule matches, and logs the fallback", () => {
    const defaultScenario: Scenario = {
      id: "generic-happy-path",
      default: true,
      steps: [{ event: "status-update", state: "working" }],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = matchScenario(
      [bugFixScenario, featureScenario, defaultScenario],
      "do something unrelated to any rule",
    );

    expect(result).toEqual({
      scenario: defaultScenario,
      matchedBy: "default",
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Default Scenario"),
      expect.objectContaining({ scenarioId: "generic-happy-path" }),
    );

    logSpy.mockRestore();
  });
});
