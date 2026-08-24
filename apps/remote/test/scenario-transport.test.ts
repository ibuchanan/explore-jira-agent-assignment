import assert from "node:assert/strict";
import test from "node:test";

import {
  currentScenarioTransport,
  runWithScenarioTransport,
  transportForJsonRpcMethod,
} from "../src/scenario-transport.js";

test("maps A2A message methods to their presentation transports", () => {
  assert.equal(transportForJsonRpcMethod("SendMessage"), "polling");
  assert.equal(transportForJsonRpcMethod("SendStreamingMessage"), "streaming");
});

test("keeps the request transport available across async work", async () => {
  await runWithScenarioTransport("streaming", async () => {
    await Promise.resolve();
    assert.equal(currentScenarioTransport(), "streaming");
  });
});
