import type { ScenarioStep } from "./scenarios.js";

export type ScenarioTransport = "polling" | "streaming";

function isCheckpoint(
  current: ScenarioStep,
  next: ScenarioStep | undefined,
): boolean {
  return (
    current.event === "status-update" &&
    current.state === "working" &&
    typeof current.message === "string" &&
    next?.event === "status-update" &&
    next.state === "input-required" &&
    next.waitForUserInput === true &&
    typeof next.message === "string"
  );
}

function terminateFinalArtifactMarkdown(step: ScenarioStep): ScenarioStep {
  if (!step.lastChunk || !step.artifact) return step;
  const lastIndex = step.artifact.parts.length - 1;
  const lastPart = step.artifact.parts[lastIndex];
  if (!lastPart || typeof lastPart.text !== "string") return step;

  const suffix = lastPart.text.endsWith("\n\n")
    ? ""
    : lastPart.text.endsWith("\n")
      ? "\n"
      : "\n\n";
  if (!suffix) return step;

  return {
    ...step,
    artifact: {
      ...step.artifact,
      parts: step.artifact.parts.map((part, index) =>
        index === lastIndex ? { ...part, text: `${part.text}${suffix}` } : part,
      ),
    },
  };
}

export function projectScenarioSteps(
  steps: ScenarioStep[],
  transport: ScenarioTransport,
): ScenarioStep[] {
  const normalized = steps.map(terminateFinalArtifactMarkdown);
  if (transport === "streaming") return normalized;

  const projected: ScenarioStep[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    if (!current) continue;
    const next = normalized[index + 1];
    if (
      current.event === "status-update" &&
      current.state === "completed" &&
      current.showConclusionBeforeCompletion === true &&
      typeof current.message === "string"
    ) {
      projected.push({
        event: "status-update",
        state: "working",
        message: current.message,
      });
      projected.push(current);
    } else if (
      next &&
      isCheckpoint(current, next) &&
      typeof current.message === "string" &&
      typeof next.message === "string"
    ) {
      const checkpoint = {
        ...next,
        message: `${current.message}\n\n${next.message}`,
      };
      if (index === 0) projected.push(current);
      projected.push(checkpoint);
      index += 1;
    } else projected.push(current);
  }
  return projected;
}
