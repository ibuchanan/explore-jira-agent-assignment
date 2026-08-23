import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";

type ScenarioArtifact = {
  artifactId: string;
  description?: string;
  metadata?: Record<string, unknown>;
  name?: string;
  parts: { kind?: string; text?: string }[];
};

export type ScenarioStep = {
  append?: boolean;
  artifact?: ScenarioArtifact;
  event?: string;
  final?: boolean;
  lastChunk?: boolean;
  message?: string;
  state?: string;
};

type Scenario = {
  default?: boolean;
  id?: string;
  match?: { contains?: unknown };
  steps?: unknown;
};

export type LoadedScenario = Required<Pick<Scenario, "id">> & {
  default: boolean;
  match: { contains: string[] };
  steps: ScenarioStep[];
};

function structuralError(filename: string, message: string): Error {
  return new Error(`Invalid scenario ${filename}: ${message}`);
}

function parseScenario(filename: string): LoadedScenario {
  let scenario: Scenario;
  try {
    scenario = parse(readFileSync(filename, "utf8")) as Scenario;
  } catch (error) {
    throw structuralError(
      filename,
      error instanceof Error ? error.message : "malformed YAML",
    );
  }
  if (!scenario || typeof scenario !== "object")
    throw structuralError(filename, "expected a YAML object");
  if (typeof scenario.id !== "string" || !scenario.id.trim())
    throw structuralError(filename, "missing scenario identity");
  if (!Array.isArray(scenario.steps) || !scenario.steps.length)
    throw structuralError(filename, "missing or empty steps");

  return {
    id: scenario.id,
    default: scenario.default === true,
    match: {
      contains: Array.isArray(scenario.match?.contains)
        ? scenario.match.contains.filter(
            (phrase): phrase is string => typeof phrase === "string",
          )
        : [],
    },
    steps: scenario.steps as ScenarioStep[],
  };
}

export function validateScenarios(
  scenarios: LoadedScenario[],
): LoadedScenario[] {
  const defaults = scenarios.filter((scenario) => scenario.default);
  if (defaults.length !== 1)
    throw new Error(
      "Scenario collection must contain exactly one Default Scenario",
    );
  const identities = new Set<string>();
  for (const scenario of scenarios) {
    if (!scenario.id?.trim())
      throw new Error("Scenario is missing an identity");
    if (identities.has(scenario.id))
      throw new Error(
        `Scenario collection has duplicate identity: ${scenario.id}`,
      );
    if (!scenario.steps?.length)
      throw new Error(`Scenario ${scenario.id} has missing or empty steps`);
    identities.add(scenario.id);
  }
  return scenarios;
}

export function loadScenarios(
  directory = resolve(process.cwd(), "../scenarios"),
): LoadedScenario[] {
  return validateScenarios(
    readdirSync(directory)
      .filter((filename) => filename.endsWith(".yaml"))
      .sort()
      .map((filename) => parseScenario(resolve(directory, filename))),
  );
}

export function selectScenario(
  scenarios: LoadedScenario[],
  startingText: string,
): LoadedScenario {
  const text = startingText.toLowerCase();
  const scenario =
    scenarios.find((candidate) =>
      candidate.match.contains.some((phrase) =>
        text.includes(phrase.toLowerCase()),
      ),
    ) ?? scenarios.find((candidate) => candidate.default);
  if (!scenario) throw new Error("Scenario collection has no default scenario");
  return scenario;
}
