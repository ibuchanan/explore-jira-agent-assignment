/**
 * Agent2Agent-visible task, message, and streaming contract.
 *
 * This module is intentionally limited to protocol-shaped data and task-state
 * lifecycle rules. Sample storage records, demo endpoints, wire formatting, and
 * validators live elsewhere.
 *
 * @see {@link https://a2a-protocol.org/latest/specification/|A2A specification}
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/|Jira remote agents}
 */

/**
 * Task state enumeration for Jira Remote Agent tasks.
 */
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "rejected"
  | "canceled"
  | "failed"
  | "unknown";

/**
 * A part of a message, either text or data.
 */
export interface MessagePart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

/**
 * Message structure for communication between Jira and agents.
 */
export interface Message {
  role: "user" | "agent";
  parts: MessagePart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  kind: "message";
}

/**
 * Task object representing work assigned to an agent.
 */
export interface Task {
  id: string;
  contextId: string;
  status: {
    state: TaskState;
    message: Message;
    timestamp: string;
  };
  kind: "task";
}

/**
 * Active task states that Jira will poll for updates.
 */
export const ACTIVE_TASK_STATES: readonly TaskState[] = [
  "submitted",
  "working",
  "auth-required",
  "unknown",
] as const;

/**
 * Terminal task states that cannot be transitioned from.
 */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "completed",
  "rejected",
  "canceled",
  "failed",
] as const;

/**
 * Valid state transitions for task lifecycle.
 */
export const TASK_STATE_TRANSITIONS: Readonly<
  Record<TaskState, readonly TaskState[]>
> = {
  submitted: ["working", "rejected", "completed", "failed"],
  working: [
    "input-required",
    "auth-required",
    "completed",
    "failed",
    "canceled",
  ],
  "input-required": ["working", "completed", "failed", "canceled"],
  "auth-required": ["working", "completed", "failed", "canceled"],
  completed: [],
  rejected: [],
  canceled: [],
  failed: [],
  unknown: ["working", "completed", "failed"],
} as const;

/**
 * Check if a task state is terminal.
 */
export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

/**
 * Check if a task state is active.
 */
export function isActiveState(state: TaskState): boolean {
  return ACTIVE_TASK_STATES.includes(state);
}

/**
 * Validate if a state transition is allowed.
 */
export function isValidTransition(
  fromState: TaskState,
  toState: TaskState,
): boolean {
  const allowedTransitions = TASK_STATE_TRANSITIONS[fromState];
  return allowedTransitions.includes(toState);
}

/**
 * Get allowed transitions from a given state.
 */
export function getAllowedTransitions(state: TaskState): readonly TaskState[] {
  return TASK_STATE_TRANSITIONS[state];
}

/**
 * A status update event emitted during SSE streaming.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/#streaming--optional-|Streaming docs}
 */
export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: {
    state: TaskState;
    timestamp?: string;
  };
  /** Optional message accompanying the status update. */
  message?: Message;
  kind: "status-update";
  /** Whether this is the final event in the stream. */
  final: boolean;
}

/**
 * A formal A2A task output produced during task execution, intended to be
 * rendered, reviewed, persisted, or referenced after it is streamed.
 *
 * `name`, `description`, and `metadata` are display/annotation text; this
 * module does not define a required metadata key schema.
 */
export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: MessagePart[];
  metadata?: Record<string, unknown>;
}

/**
 * An artifact update event emitted during SSE streaming. Carries a Jira/
 * user-reviewable task output, either complete or as an incremental chunk
 * using the A2A `append`/`lastChunk` fields.
 */
export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  /** When true, append this artifact's parts to the previous chunk rather than replacing it. */
  append?: boolean;
  /** When true, this is the final chunk of the artifact. */
  lastChunk?: boolean;
  kind: "artifact-update";
}

/**
 * The result payload of each SSE event in a streaming response.
 * Each event contains exactly one of: task, statusUpdate, message, or artifactUpdate.
 *
 * - `task`: returned as the first event in the stream
 * - `statusUpdate`: subsequent progress/state-change events
 * - `message`: for simple one-shot responses that don't require task tracking
 * - `artifactUpdate`: a Jira/user-reviewable task output, complete or chunked
 */
export interface StreamResponse {
  task?: Task;
  statusUpdate?: TaskStatusUpdateEvent;
  message?: Message;
  artifactUpdate?: TaskArtifactUpdateEvent;
}
