/**
 * Provider-neutral Remote Agent Signal mapping tests
 *
 * These tests specify how Remote Agent Signal categories become A2A-visible
 * Task State Updates, Content Updates, and Artifact updates, independent of
 * any provider's runtime event names and independent of wire transport.
 *
 * @see specs/tickets/02-provider-neutral-signal-mapping.md
 */

import { describe, expect, it } from "vitest";
import type { Artifact } from "../../src/rovo/a2aContract";
import {
  mapRemoteAgentSignal,
  type RemoteAgentSignal,
} from "../../src/rovo/signalMapper";

const artifact: Artifact = {
  artifactId: "artifact-1",
  parts: [{ kind: "text", text: "Summary of changes" }],
};

// One instance per normally-mapped RemoteAgentSignal category.
const ALL_NORMAL_SIGNALS: RemoteAgentSignal[] = [
  { category: "runtime-started" },
  { category: "completed", summary: "Done." },
  { category: "failed", reason: "Unrecoverable error." },
  { category: "rejected", reason: "Unsupported work." },
  { category: "canceled", reason: "Canceled by user." },
  { category: "approval-needed", detail: "Approval required: push." },
  { category: "input-needed", detail: "Input required: branch?" },
  { category: "resumed" },
  { category: "thinking-process", summary: "Looking around." },
  { category: "internal-thinking", text: "Weighing approaches." },
  { category: "model-request-progress", detail: "Model call started." },
  { category: "tool-use", detail: "Reading a file." },
  { category: "tool-result", detail: "File read." },
  { category: "artifact-produced", artifact },
];

describe("mapRemoteAgentSignal", () => {
  it("maps runtime-started to a working task-state-update", () => {
    const event = mapRemoteAgentSignal({ category: "runtime-started" });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "working",
      final: false,
    });
  });

  it("maps completed to a final completed task-state-update carrying the summary", () => {
    const event = mapRemoteAgentSignal({
      category: "completed",
      summary: "Implementation finished.",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "completed",
      final: true,
      message: "Implementation finished.",
    });
  });

  it("maps failed to a final failed task-state-update carrying the reason, distinct from rejected/canceled", () => {
    const event = mapRemoteAgentSignal({
      category: "failed",
      reason: "Could not apply the patch after acceptance.",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "failed",
      final: true,
      message: "Could not apply the patch after acceptance.",
    });
  });

  it("maps rejected to a final rejected task-state-update carrying the reason, for pre-execution refusal", () => {
    const event = mapRemoteAgentSignal({
      category: "rejected",
      reason: "Unsupported work item type.",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "rejected",
      final: true,
      message: "Unsupported work item type.",
    });
  });

  it("maps canceled to a final canceled task-state-update, for Jira/user-requested cancellation", () => {
    const event = mapRemoteAgentSignal({
      category: "canceled",
      reason: "Canceled by user.",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "canceled",
      final: true,
      message: "Canceled by user.",
    });
  });

  it("maps approval-needed to a non-final auth-required task-state-update carrying the Approval Request", () => {
    const event = mapRemoteAgentSignal({
      category: "approval-needed",
      detail: "Approval required: push to main branch.",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "auth-required",
      final: false,
      message: "Approval required: push to main branch.",
    });
  });

  it("maps input-needed to a non-final input-required task-state-update carrying the Input Need", () => {
    const event = mapRemoteAgentSignal({
      category: "input-needed",
      detail: "Input required: which branch should this target?",
    });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "input-required",
      final: false,
      message: "Input required: which branch should this target?",
    });
  });

  it("maps resumed to a non-final working task-state-update, so resumption returns to working before content", () => {
    const event = mapRemoteAgentSignal({ category: "resumed" });
    expect(event).toEqual({
      kind: "task-state-update",
      state: "working",
      final: false,
    });
  });

  it("maps thinking-process to a content-update, not a task-state-update, since it does not change lifecycle", () => {
    const event = mapRemoteAgentSignal({
      category: "thinking-process",
      summary: "Inspecting the repository and locating related code paths.",
    });
    expect(event).toEqual({
      kind: "content-update",
      message: "Inspecting the repository and locating related code paths.",
    });
  });

  it("maps internal-thinking to a content-update, as a category distinct from thinking-process", () => {
    const event = mapRemoteAgentSignal({
      category: "internal-thinking",
      text: "Considering whether to patch the parser or the caller.",
    });
    expect(event).toEqual({
      kind: "content-update",
      message: "Considering whether to patch the parser or the caller.",
    });
  });

  it("maps model-request-progress to a content-update", () => {
    const event = mapRemoteAgentSignal({
      category: "model-request-progress",
      detail: "Model call started to plan the edit.",
    });
    expect(event).toEqual({
      kind: "content-update",
      message: "Model call started to plan the edit.",
    });
  });

  it("maps tool-use to a content-update describing the invocation, not a task output", () => {
    const event = mapRemoteAgentSignal({
      category: "tool-use",
      detail: "Searching the repository for related modules.",
    });
    expect(event).toEqual({
      kind: "content-update",
      message: "Searching the repository for related modules.",
    });
  });

  it("maps tool-result to a content-update unless the result is a reviewable task output", () => {
    const event = mapRemoteAgentSignal({
      category: "tool-result",
      detail: "Found the relevant module in src/handlers/checkout.ts.",
    });
    expect(event).toEqual({
      kind: "content-update",
      message: "Found the relevant module in src/handlers/checkout.ts.",
    });
  });

  it("maps artifact-produced to an artifact-update carrying the Jira/user-reviewable output", () => {
    const artifact: Artifact = {
      artifactId: "artifact-1",
      name: "Implementation summary",
      parts: [{ kind: "text", text: "Summary of changes" }],
    };
    const event = mapRemoteAgentSignal({
      category: "artifact-produced",
      artifact,
    });
    expect(event).toEqual({
      kind: "artifact-update",
      artifact,
    });
  });

  it("never maps a normal, defined signal category to the unknown state", () => {
    for (const signal of ALL_NORMAL_SIGNALS) {
      const event = mapRemoteAgentSignal(signal);
      if (event.kind === "task-state-update") {
        expect(event.state).not.toBe("unknown");
      }
    }
  });

  it("falls back to a non-final unknown task-state-update for an unrecognized signal category", () => {
    const malformedSignal = {
      category: "some-provider-specific-event-name",
    } as unknown as RemoteAgentSignal;
    const event = mapRemoteAgentSignal(malformedSignal);
    expect(event).toEqual({
      kind: "task-state-update",
      state: "unknown",
      final: false,
    });
  });
});
