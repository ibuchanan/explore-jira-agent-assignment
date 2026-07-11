/**
 * A2A-visible JSON-RPC SSE stream adapter.
 *
 * This module owns the wire shape for streamed A2A-visible events: converting
 * mapped execution events into StreamResponse payloads, wrapping them in
 * JSON-RPC envelopes, and writing Server-Sent Events.
 */

import {
  createErrorResponse,
  formatAgentConnectorTaskResponse,
  type JsonRpcResponse,
  type MappedEvent,
  type StreamResponse,
  type TaskArtifactUpdateEvent,
  type TaskStatusUpdateEvent,
} from "forge-ahead";
import type { SimulationScenarioSessionStream } from "./scenarioSessionRuntime.js";
import type { Task } from "./storage.js";

export interface A2aJsonRpcSseWriter {
  setHeader: (name: string, value: string) => void;
  flushHeaders: () => void;
  write: (chunk: string) => unknown;
  end: () => unknown;
}

export interface A2aJsonRpcSessionStreamOptions {
  response: A2aJsonRpcSseWriter;
  requestId: string;
  onEvent?: (event: MappedEvent, task: Task) => void;
}

export function startA2aJsonRpcStream(response: A2aJsonRpcSseWriter): void {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
}

export function buildStreamResponseFromMappedEvent(
  event: MappedEvent,
  task: Task,
): StreamResponse {
  if (event.kind === "artifact-update") {
    const artifactUpdate: TaskArtifactUpdateEvent = {
      taskId: task.id,
      contextId: task.contextId,
      artifact: event.artifact,
      kind: "artifact-update",
      ...(event.append !== undefined && { append: event.append }),
      ...(event.lastChunk !== undefined && { lastChunk: event.lastChunk }),
    };
    return { artifactUpdate };
  }

  const statusUpdate: TaskStatusUpdateEvent = {
    taskId: task.id,
    contextId: task.contextId,
    status: { state: task.status.state, timestamp: task.status.timestamp },
    message: task.status.message,
    kind: "status-update",
    final: event.kind === "task-state-update" ? event.final : false,
  };
  return { statusUpdate };
}

export function buildTaskSnapshotStreamResponse(task: Task): StreamResponse {
  return {
    task: formatAgentConnectorTaskResponse(
      task,
      task.contextId,
    ) as StreamResponse["task"],
  };
}

export function encodeA2aJsonRpcStreamEnvelope(
  envelope: JsonRpcResponse,
): string {
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

export function writeA2aJsonRpcStreamResult(
  response: A2aJsonRpcSseWriter,
  requestId: string,
  result: StreamResponse,
): void {
  response.write(
    encodeA2aJsonRpcStreamEnvelope({
      jsonrpc: "2.0",
      id: requestId,
      result,
    }),
  );
}

export function writeA2aJsonRpcStreamError(
  response: A2aJsonRpcSseWriter,
  requestId: string,
  code: number,
  message: string,
): void {
  response.write(
    encodeA2aJsonRpcStreamEnvelope(
      createErrorResponse(requestId, code, message),
    ),
  );
}

export function writeA2aJsonRpcTaskSnapshot(
  response: A2aJsonRpcSseWriter,
  requestId: string,
  task: Task,
): void {
  writeA2aJsonRpcStreamResult(
    response,
    requestId,
    buildTaskSnapshotStreamResponse(task),
  );
}

export function createA2aJsonRpcSessionStream({
  response,
  requestId,
  onEvent,
}: A2aJsonRpcSessionStreamOptions): SimulationScenarioSessionStream {
  return {
    emit: (event, task) => {
      writeA2aJsonRpcStreamResult(
        response,
        requestId,
        buildStreamResponseFromMappedEvent(event, task),
      );
      onEvent?.(event, task);
    },
    close: () => {
      response.end();
    },
  };
}
