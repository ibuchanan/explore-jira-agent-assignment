/**
 * Agent Connector compatibility exports.
 *
 * Focused protocol, method, formatting, and validation modules live beside this
 * file. This barrel preserves the historical internal import path without
 * keeping sample storage or demo endpoint shapes in the shared A2A contract.
 */

export type { JsonRpcRequest, JsonRpcResponse } from "../util/jsonrpc";
export { isJsonRpcError } from "../util/jsonrpc";

export type {
  Artifact,
  Message,
  MessagePart,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from "./a2aContract";
export {
  ACTIVE_TASK_STATES,
  getAllowedTransitions,
  isActiveState,
  isTerminalState,
  isValidTransition,
  TASK_STATE_TRANSITIONS,
  TERMINAL_TASK_STATES,
} from "./a2aContract";
export { formatAgentConnectorTaskResponse } from "./agentConnectorFormatting";
export type {
  AgentConnectorMethod,
  AgentConnectorRequest,
  AgentConnectorResponse,
  CancelTaskParams,
  GetTaskParams,
  ResubscribeTaskParams,
  SendMessageParams,
} from "./agentConnectorMethods";
export {
  isValidAgentConnectorResponse,
  isValidStreamResponse,
} from "./agentConnectorValidation";
