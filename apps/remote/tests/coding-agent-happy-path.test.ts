/**
 * Simulated Coding Remote Agent happy path scenario content
 *
 * @see specs/tickets/05-coding-agent-content-happy-path.md
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
const CODING_TASK_TEXT =
  'You have been assigned to a work item "Fix the login bug". Analyze the details of the work item and get started.';

// Illustrative label prefixes from docs/adr/0027 and docs/adr/0029: text
// conventions, not a required message schema.
const LABEL_PREFIXES = ["Internal thinking:", "Tool:", "Tool result:"];

function isLabeledContent(message: string): boolean {
  return LABEL_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function matchCodingAgentScenario(): Scenario {
  const result = loadScenarios(SCENARIOS_DIR);
  if (result.isErr()) {
    throw new Error(result.error.detail);
  }
  return matchScenario(result.value, CODING_TASK_TEXT).scenario;
}

function contentUpdateMessages(scenario: Scenario): string[] {
  return scenario.steps
    .map((step) => mapScenarioStep(step))
    .filter((event) => event.kind === "content-update")
    .map((event) => (event as { message: string }).message);
}

describe("Simulated Coding Remote Agent happy path scenario", () => {
  it("is matched from coding-task starting text instead of the Default Scenario", () => {
    const scenario = matchCodingAgentScenario();

    expect(scenario.id).toBe("coding-agent-happy-path");
  });

  it("streams a Thinking Process summary as an ordinary progress message with no special label", () => {
    const messages = contentUpdateMessages(matchCodingAgentScenario());

    expect(messages.some((message) => !isLabeledContent(message))).toBe(true);
  });

  it("streams Internal Thinking as separately labeled plain text, distinct from the Thinking Process message", () => {
    const messages = contentUpdateMessages(matchCodingAgentScenario());
    const internalThinkingIndex = messages.findIndex((message) =>
      message.startsWith("Internal thinking:"),
    );
    const thinkingProcessIndex = messages.findIndex(
      (message) => !isLabeledContent(message),
    );

    expect(internalThinkingIndex).toBeGreaterThanOrEqual(0);
    expect(internalThinkingIndex).not.toBe(thinkingProcessIndex);
  });

  it("streams Tool Activity as status content with light labels for invocation and result, in order", () => {
    const messages = contentUpdateMessages(matchCodingAgentScenario());
    const toolInvocationIndex = messages.findIndex((message) =>
      message.startsWith("Tool:"),
    );
    const toolResultIndex = messages.findIndex((message) =>
      message.startsWith("Tool result:"),
    );

    expect(toolInvocationIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThan(toolInvocationIndex);
  });

  it("ends with a brief completed lifecycle message", () => {
    const scenario = matchCodingAgentScenario();
    const lastStep = scenario.steps[scenario.steps.length - 1];
    const lastEvent = mapScenarioStep(lastStep);

    expect(lastEvent).toMatchObject({
      kind: "task-state-update",
      state: "completed",
      final: true,
    });
    const message =
      lastEvent.kind === "task-state-update" ? lastEvent.message : undefined;
    expect(message).toBeTruthy();
    expect((message ?? "").split(" ").length).toBeLessThanOrEqual(15);
  });
});
