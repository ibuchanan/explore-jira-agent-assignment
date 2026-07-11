/**
 * Simulation Scenario loading and matching
 *
 * Reads human-editable YAML Simulation Scenarios for the A2A Simulator,
 * validates their required structure, and matches them deterministically
 * against the starting task text or context.
 */

import fs from "node:fs";
import path from "node:path";
import {
  ok,
  type ProblemDetails,
  type Result,
  StandardError,
} from "forge-ahead";
import YAML from "yaml";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ScenarioStep {
  event: string;
  state?: string;
  final?: boolean;
  message?: string;
  artifact?: Record<string, unknown>;
  /** When true, append this artifact-update step's parts to the previous chunk rather than replacing it. */
  append?: boolean;
  /** When true, this artifact-update step is the final chunk of the artifact. */
  lastChunk?: boolean;
  delayMs?: number;
  waitForUserInput?: boolean;
}

export interface ScenarioMatch {
  contains: string[];
}

export interface Scenario {
  id: string;
  default?: boolean;
  match?: ScenarioMatch;
  steps: ScenarioStep[];
}

export interface ScenarioMatchResult {
  scenario: Scenario;
  matchedBy: "rule" | "default";
}

/**
 * Structural validation only: catches missing/mistyped required fields.
 * It intentionally does not judge A2A or Jira semantic compliance (see
 * docs/adr/0037-scenario-validation-is-structural-not-semantic.md).
 */
function validateScenarioStructure(
  value: unknown,
  filename: string,
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `Malformed scenario in ${filename}: expected a YAML mapping`;
  }

  const scenario = value as Record<string, unknown>;

  if (typeof scenario.id !== "string" || scenario.id.trim() === "") {
    return `Malformed scenario in ${filename}: missing required "id" string`;
  }

  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    return `Malformed scenario "${scenario.id}" in ${filename}: missing required non-empty "steps" array`;
  }

  return undefined;
}

export function loadScenarios(dir: string): Result<Scenario[], ProblemDetails> {
  const filenames = fs
    .readdirSync(dir)
    .filter(
      (filename) => filename.endsWith(".yaml") || filename.endsWith(".yml"),
    )
    .sort();

  const scenarios: Scenario[] = [];
  for (const filename of filenames) {
    const content = fs.readFileSync(path.join(dir, filename), "utf8");

    let parsed: unknown;
    try {
      parsed = YAML.parse(content);
    } catch (error) {
      return StandardError.getOrDefault(400).error(
        `Malformed scenario YAML in ${filename}: ${getErrorMessage(error)}`,
      );
    }

    const structureError = validateScenarioStructure(parsed, filename);
    if (structureError) {
      return StandardError.getOrDefault(400).error(structureError);
    }

    scenarios.push(parsed as Scenario);
  }

  return ok(scenarios);
}

export function matchScenario(
  scenarios: Scenario[],
  taskText: string,
): ScenarioMatchResult {
  const normalizedTaskText = taskText.toLowerCase();

  for (const scenario of scenarios) {
    const phrases = scenario.match?.contains ?? [];
    const isMatch = phrases.some((phrase) =>
      normalizedTaskText.includes(phrase.toLowerCase()),
    );
    if (isMatch) {
      return { scenario, matchedBy: "rule" };
    }
  }

  const defaultScenario = scenarios.find(
    (scenario) => scenario.default === true,
  );
  if (!defaultScenario) {
    throw new Error(
      "No scenario rule matched and no Default Scenario (default: true) was found.",
    );
  }

  console.log("Scenario matching fell back to the Default Scenario", {
    scenarioId: defaultScenario.id,
    taskText,
  });

  return { scenario: defaultScenario, matchedBy: "default" };
}
