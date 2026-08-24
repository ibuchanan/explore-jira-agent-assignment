import { AsyncLocalStorage } from "node:async_hooks";

import type { ScenarioTransport } from "./scenario-presentation.js";

const transportStorage = new AsyncLocalStorage<ScenarioTransport>();

export function transportForJsonRpcMethod(
  method: string | undefined,
): ScenarioTransport {
  return method === "SendStreamingMessage" ? "streaming" : "polling";
}

export function runWithScenarioTransport<Result>(
  transport: ScenarioTransport,
  callback: () => Result,
): Result {
  return transportStorage.run(transport, callback);
}

export function currentScenarioTransport(): ScenarioTransport {
  return transportStorage.getStore() ?? "polling";
}
