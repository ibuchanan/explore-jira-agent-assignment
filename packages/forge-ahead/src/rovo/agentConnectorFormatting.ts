/**
 * Formatting helpers for Jira remote-agent JSON-RPC responses.
 */

import type { Task } from "./a2aContract";

/**
 * Format a Task object according to the A2A protocol specification for JSON-RPC responses.
 * This ensures the task is properly structured for Jira to consume.
 *
 * @param task - The task object to format
 * @param contextId - The context ID to include in the response
 * @returns Formatted task object ready for JSON-RPC response
 *
 * @example
 * ```typescript
 * const formattedTask = formatAgentConnectorTaskResponse(task, contextId);
 * res.json({ jsonrpc: "2.0", id, result: formattedTask });
 * ```
 */
export function formatAgentConnectorTaskResponse(
  task: Task,
  contextId: string,
): Task {
  const messageId = task.status.message.messageId || task.id;

  return {
    id: task.id,
    contextId,
    status: {
      state: task.status.state,
      message: {
        role: "agent",
        parts: task.status.message.parts,
        messageId,
        taskId: task.id,
        contextId,
        kind: "message",
      },
      timestamp: task.status.timestamp,
    },
    kind: "task",
  };
}
