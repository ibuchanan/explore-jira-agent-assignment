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

export function projectScenarioSteps(
  steps: ScenarioStep[],
  transport: ScenarioTransport,
): ScenarioStep[] {
  if (transport === "streaming") return steps;

  const projected: ScenarioStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    if (!current) continue;
    const next = steps[index + 1];
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
