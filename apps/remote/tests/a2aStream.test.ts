/**
 * A2A-visible stream adapter tests.
 *
 * These tests exercise the stream adapter seam directly: mapped events go in,
 * JSON-RPC SSE frames come out.
 */

import { describe, expect, it } from "vitest";
import {
  buildStreamResponseFromMappedEvent,
  createA2aJsonRpcSessionStream,
  startA2aJsonRpcStream,
  writeA2aJsonRpcStreamError,
  writeA2aJsonRpcTaskSnapshot,
  type A2aJsonRpcSseWriter,
} from "../src/a2aStream.js";
import type { Task } from "../src/storage.js";

const task: Task = {
  id: "task-1",
  contextId: "ctx-1",
  status: {
    state: "working",
    message: {
      role: "agent",
      parts: [{ kind: "text", text: "Working." }],
      messageId: "msg-1",
      taskId: "task-1",
      contextId: "ctx-1",
      kind: "message",
    },
    timestamp: "2026-07-11T09:45:00.000Z",
  },
  kind: "task",
};

function createWriter(): {
  writer: A2aJsonRpcSseWriter;
  headers: Record<string, string>;
  chunks: string[];
  ended: () => boolean;
} {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  let closed = false;

  return {
    writer: {
      setHeader: (name, value) => {
        headers[name] = value;
      },
      flushHeaders: () => {},
      write: (chunk) => {
        chunks.push(chunk);
      },
      end: () => {
        closed = true;
      },
    },
    headers,
    chunks,
    ended: () => closed,
  };
}

function parseSseEnvelope(chunk: string): unknown {
  expect(chunk.startsWith("data: ")).toBe(true);
  expect(chunk.endsWith("\n\n")).toBe(true);
  return JSON.parse(chunk.slice("data: ".length));
}

describe("A2A-visible stream adapter", () => {
  it("builds status updates from mapped task state events", () => {
    expect(
      buildStreamResponseFromMappedEvent(
        {
          kind: "task-state-update",
          state: "completed",
          final: true,
          message: "Done.",
        },
        { ...task, status: { ...task.status, state: "completed" } },
      ),
    ).toEqual({
      statusUpdate: {
        taskId: "task-1",
        contextId: "ctx-1",
        status: {
          state: "completed",
          timestamp: "2026-07-11T09:45:00.000Z",
        },
        message: task.status.message,
        kind: "status-update",
        final: true,
      },
    });
  });

  it("builds artifact updates with chunking fields", () => {
    expect(
      buildStreamResponseFromMappedEvent(
        {
          kind: "artifact-update",
          artifact: {
            artifactId: "patch-1",
            parts: [{ kind: "text", text: "diff --git" }],
          },
          append: true,
          lastChunk: true,
        },
        task,
      ),
    ).toEqual({
      artifactUpdate: {
        taskId: "task-1",
        contextId: "ctx-1",
        artifact: {
          artifactId: "patch-1",
          parts: [{ kind: "text", text: "diff --git" }],
        },
        append: true,
        lastChunk: true,
        kind: "artifact-update",
      },
    });
  });

  it("starts an SSE stream and writes task and error JSON-RPC envelopes", () => {
    const { writer, headers, chunks } = createWriter();

    startA2aJsonRpcStream(writer);
    writeA2aJsonRpcTaskSnapshot(writer, "req-1", task);
    writeA2aJsonRpcStreamError(writer, "req-2", -32001, "Task not found");

    expect(headers).toEqual({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(parseSseEnvelope(chunks[0])).toMatchObject({
      jsonrpc: "2.0",
      id: "req-1",
      result: { task: { id: "task-1", contextId: "ctx-1" } },
    });
    expect(parseSseEnvelope(chunks[1])).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      error: { code: -32001, message: "Task not found" },
    });
  });

  it("adapts Simulation Scenario Session events to JSON-RPC SSE frames", () => {
    const { writer, chunks, ended } = createWriter();
    const observed: string[] = [];
    const stream = createA2aJsonRpcSessionStream({
      response: writer,
      requestId: "req-stream",
      onEvent: (event, currentTask) => {
        observed.push(`${event.kind}:${currentTask.id}`);
      },
    });

    stream.emit({ kind: "content-update", message: "Working..." }, task);
    stream.close();

    expect(parseSseEnvelope(chunks[0])).toMatchObject({
      jsonrpc: "2.0",
      id: "req-stream",
      result: {
        statusUpdate: {
          taskId: "task-1",
          contextId: "ctx-1",
          final: false,
        },
      },
    });
    expect(observed).toEqual(["content-update:task-1"]);
    expect(ended()).toBe(true);
  });
});
