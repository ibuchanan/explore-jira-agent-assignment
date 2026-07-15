/**
 * Input-required work clarification pause and resumption scenario content
 *
 * @see specs/tickets/07-input-required-clarification-resumption.md
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadScenarios,
  matchScenario,
  type Scenario,
} from "../src/scenarios.js";
import { mapScenarioStep } from "../src/scenarioStepMapper.js";

const SCENARIOS_DIR = path.join(process.cwd(), "scenarios");
const CHECKOUT_TASK_TEXT =
  'You have been assigned to a work item "Redesign checkout". Clarify the acceptance criteria for the checkout redesign and get started.';

function matchInputRequiredScenario(): Scenario {
  const result = loadScenarios(SCENARIOS_DIR);
  if (result.isErr()) {
    throw new Error(result.error.detail);
  }
  const matchResult = matchScenario(result.value, CHECKOUT_TASK_TEXT);
  if (matchResult.isErr()) {
    throw new Error(matchResult.error.detail);
  }
  return matchResult.value.scenario;
}

describe("Input-required work clarification pause and resumption scenario", () => {
  it("is matched from checkout task text instead of the Default Scenario", () => {
    const scenario = matchInputRequiredScenario();

    expect(scenario.id).toBe("input-required-clarification-resumption");
  });

  it("includes exactly one input-required pause with a clearly labeled Input Need message, not an Approval Request label", () => {
    const scenario = matchInputRequiredScenario();
    const inputRequiredSteps = scenario.steps.filter(
      (step) => step.state === "input-required",
    );

    expect(inputRequiredSteps).toHaveLength(1);
    expect(inputRequiredSteps[0].waitForUserInput).toBe(true);
    expect(inputRequiredSteps[0].message).toMatch(/^Input required:/);
    expect(inputRequiredSteps[0].message).not.toMatch(/^Approval required:/);
  });

  it("resumes to working immediately after the input-required pause, before any further step", () => {
    const scenario = matchInputRequiredScenario();
    const pauseIndex = scenario.steps.findIndex(
      (step) => step.state === "input-required",
    );
    const nextStep = scenario.steps[pauseIndex + 1];

    expect(mapScenarioStep(nextStep)).toMatchObject({
      kind: "task-state-update",
      state: "working",
    });
  });

  it("ends with a completed lifecycle message after resumption", () => {
    const scenario = matchInputRequiredScenario();
    const lastStep = scenario.steps[scenario.steps.length - 1];

    expect(mapScenarioStep(lastStep)).toMatchObject({
      kind: "task-state-update",
      state: "completed",
      final: true,
    });
  });
});
