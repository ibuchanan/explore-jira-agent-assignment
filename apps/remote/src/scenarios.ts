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
  action?: "read" | "comment" | "mention" | "transition";
  append?: boolean;
  artifact?: ScenarioArtifact;
  delayMs?: number;
  event?: string;
  final?: boolean;
  lastChunk?: boolean;
  message?: string;
  result?: "simulated" | "auth-required" | "rejected" | "failed";
  state?: string;
  waitForUserInput?: boolean;
};

type WorkItemRule = { fields?: Record<string, string>; id?: string };
type CommentRule = { body?: string; id?: string };
export type MatchCategory =
  | "comment"
  | "default"
  | "entry-surface"
  | "invoker"
  | "text"
  | "tenant"
  | "work-item";
type ScenarioMatch = {
  comment?: CommentRule;
  contains: string[];
  entrySurface?: string;
  invokerId?: string;
  tenantId?: string;
  workItem?: WorkItemRule;
};

type Scenario = {
  default?: boolean;
  id?: string;
  match?: {
    comment?: CommentRule;
    contains?: unknown;
    entrySurface?: string;
    invokerId?: string;
    tenantId?: string;
    workItem?: WorkItemRule;
  };
  steps?: unknown;
};

export type LoadedScenario = Required<Pick<Scenario, "id">> & {
  default: boolean;
  match: ScenarioMatch;
  steps: ScenarioStep[];
};

type ContextAvailability = "available" | "missing" | "restricted";

export type InvocationContext = {
  comment: {
    availability: ContextAvailability;
    body?: string;
    id?: string;
  };
  entrySurface: string;
  invokerId: string;
  tenantId: string;
  text: string;
  workItem: {
    availability: ContextAvailability;
    fields: Record<string, unknown>;
    id?: string;
  };
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
      ...(scenario.match?.comment ? { comment: scenario.match.comment } : {}),
      ...(typeof scenario.match?.entrySurface === "string"
        ? { entrySurface: scenario.match.entrySurface }
        : {}),
      ...(typeof scenario.match?.invokerId === "string"
        ? { invokerId: scenario.match.invokerId }
        : {}),
      ...(typeof scenario.match?.tenantId === "string"
        ? { tenantId: scenario.match.tenantId }
        : {}),
      ...(scenario.match?.workItem
        ? { workItem: scenario.match.workItem }
        : {}),
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

function normalizeContext(
  context: InvocationContext | string,
): InvocationContext {
  if (typeof context !== "string") return context;
  return {
    text: context,
    workItem: { availability: "missing", fields: {} },
    comment: { availability: "missing" },
    entrySurface: "",
    tenantId: "",
    invokerId: "",
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function invocationContextFromParts(
  parts: unknown[],
): InvocationContext {
  const text = parts
    .flatMap((part) => {
      const value = record(part);
      const content = record(value.content);
      const text =
        value.text ?? (content.$case === "text" ? content.value : undefined);
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
  const data = parts
    .map((part) => {
      const value = record(part);
      const content = record(value.content);
      return (
        value.data ?? (content.$case === "data" ? content.value : undefined)
      );
    })
    .find((value) => value !== undefined);
  const context = record(record(data).invocationContext ?? data);
  const workItem = record(context.workItem ?? context.issue);
  const comment = record(context.comment);
  const availability = (value: Record<string, unknown>) =>
    value.restricted === true
      ? "restricted"
      : Object.keys(value).length
        ? "available"
        : "missing";
  const normalizedWorkItem: InvocationContext["workItem"] = {
    availability: availability(workItem),
    fields: record(workItem.fields),
  };
  const workItemId = string(workItem.id);
  if (workItemId) normalizedWorkItem.id = workItemId;
  const normalizedComment: InvocationContext["comment"] = {
    availability: availability(comment),
  };
  const commentId = string(comment.id);
  if (commentId) normalizedComment.id = commentId;
  const commentBody = string(comment.body);
  if (commentBody) normalizedComment.body = commentBody;
  return {
    text,
    workItem: normalizedWorkItem,
    comment: normalizedComment,
    entrySurface: string(context.entrySurface) ?? "",
    tenantId: string(context.tenantId) ?? "",
    invokerId: string(context.invokerId) ?? "",
  };
}

function includes(value: unknown, expected: string): boolean {
  return (
    typeof value === "string" &&
    value.toLowerCase().includes(expected.toLowerCase())
  );
}

function matchCategory(
  scenario: LoadedScenario,
  context: InvocationContext,
): MatchCategory | undefined {
  if (scenario.match.contains.some((phrase) => includes(context.text, phrase)))
    return "text";
  const workItem = scenario.match.workItem;
  if (context.workItem.availability === "available" && workItem) {
    if (workItem.id !== undefined && context.workItem.id === workItem.id)
      return "work-item";
    if (
      Object.entries(workItem.fields ?? {}).some(([field, value]) =>
        includes(context.workItem.fields[field], value),
      )
    )
      return "work-item";
  }
  const comment = scenario.match.comment;
  if (
    context.comment.availability === "available" &&
    ((comment?.id !== undefined && context.comment.id === comment.id) ||
      (comment?.body !== undefined &&
        includes(context.comment.body, comment.body)))
  )
    return "comment";
  if (scenario.match.entrySurface === context.entrySurface)
    return "entry-surface";
  if (scenario.match.tenantId === context.tenantId) return "tenant";
  if (scenario.match.invokerId === context.invokerId) return "invoker";
  return undefined;
}

export type ScenarioSelection = {
  category: MatchCategory;
  scenario: LoadedScenario;
};

export function selectScenarioWithDiagnostic(
  scenarios: LoadedScenario[],
  invocationContext: InvocationContext | string,
): ScenarioSelection {
  const context = normalizeContext(invocationContext);
  for (const scenario of scenarios) {
    const category = matchCategory(scenario, context);
    if (category) return { scenario, category };
  }
  const scenario = scenarios.find((candidate) => candidate.default);
  if (!scenario) throw new Error("Scenario collection has no default scenario");
  return { scenario, category: "default" };
}

export function selectScenario(
  scenarios: LoadedScenario[],
  invocationContext: InvocationContext | string,
): LoadedScenario {
  return selectScenarioWithDiagnostic(scenarios, invocationContext).scenario;
}
