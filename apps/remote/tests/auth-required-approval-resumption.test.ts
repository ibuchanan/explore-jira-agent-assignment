/**
 * Auth-required Tool Approval pause and resumption scenario content
 *
 * @see specs/tickets/06-auth-required-approval-resumption.md
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadScenarios,
  matchScenario,
  type Scenario,
} from "../src/scenarios.js";
import { mapScenarioStep } from "../src/simulator.js";

const SCENARIOS_DIR = path.join(process.cwd(), "scenarios");
const HOTFIX_TASK_TEXT =
  'You have been assigned to a work item "Push the hotfix". Push the hotfix to the repository and get started.';

function matchAuthRequiredScenario(): Scenario {
  const result = loadScenarios(SCENARIOS_DIR);
  if (result.isErr()) {
    throw new Error(result.error.detail);
  }
  return matchScenario(result.value, HOTFIX_TASK_TEXT).scenario;
}

describe("Auth-required approval pause and resumption scenario", () => {
  it("is matched from hotfix task text instead of the Default Scenario", () => {
    const scenario = matchAuthRequiredScenario();

    expect(scenario.id).toBe("auth-required-approval-resumption");
  });

  it("includes exactly one auth-required pause with a clearly labeled Approval Request message", () => {
    const scenario = matchAuthRequiredScenario();
    const authRequiredSteps = scenario.steps.filter(
      (step) => step.state === "auth-required",
    );

    expect(authRequiredSteps).toHaveLength(1);
    expect(authRequiredSteps[0].waitForUserInput).toBe(true);
    expect(authRequiredSteps[0].message).toMatch(/^Approval required:/);
  });

  it("resumes to working immediately after the auth-required pause, before any further step", () => {
    const scenario = matchAuthRequiredScenario();
    const pauseIndex = scenario.steps.findIndex(
      (step) => step.state === "auth-required",
    );
    const nextStep = scenario.steps[pauseIndex + 1];

    expect(mapScenarioStep(nextStep)).toMatchObject({
      kind: "task-state-update",
      state: "working",
    });
  });

  it("ends with a completed lifecycle message after resumption", () => {
    const scenario = matchAuthRequiredScenario();
    const lastStep = scenario.steps[scenario.steps.length - 1];

    expect(mapScenarioStep(lastStep)).toMatchObject({
      kind: "task-state-update",
      state: "completed",
      final: true,
    });
  });
});
