// Re-export authentication utilities

// Atlassian Cloud utilities
export { extractCloudId } from "./cloud/site";
export { getAuthForEvent } from "./forge/auth";

// Re-export common Forge function types
export type {
  CommonEvent,
  EventContext,
} from "./forge/function";
// Re-export logging utilities
export { logContext, logResult, truncateEvents } from "./forge/logging";
export type {
  ForgeInvocationTokenPayload,
  JwtHeader,
  JwtPayload,
  JwtToken,
} from "./forge/remote";
// Re-export Forge Remote JWT utilities
export {
  createJwksKeyStore,
  fetchAtlassianJwks,
  getKeyIdFromToken,
  isJwtExpired,
  parseJwt,
  validateAuthHeader,
  verifyAndParseJwt,
  verifyJwt,
} from "./forge/remote";
// Re-export Forge lifecycle event types
export type {
  InstallationEvent,
  LifecycleEvent,
  UpgradeEvent,
} from "./forge/triggers/lifecycle";
// Re-export JSON type primitives
export type { JSONArray, JSONObject, JSONValue } from "./forge/types";

// Re-export Rovo action types for use in Rovo agent actions
export type {
  RovoActionFunction,
  RovoEvent,
  RovoResponse,
} from "./rovo/action";
// Re-export Agent2Agent (A2A) protocol types
// Re-export Agent Connector types and utilities
export type {
  AdvanceTaskRequest,
  AdvanceTaskResponse,
  AgentConnectorDatabaseSchema,
  AgentConnectorRequest,
  AgentConnectorResponse,
  AgentContext,
  Artifact,
  CancelTaskParams,
  CancelTaskParams as AgentConnectorCancelTaskParams,
  GetTaskParams,
  GetTaskParams as AgentConnectorGetTaskParams,
  JiraInstallation,
  Message,
  MessagePart,
  ResubscribeTaskParams,
  ResubscribeTaskParams as AgentConnectorResubscribeTaskParams,
  SendMessageParams,
  SendMessageParams as AgentConnectorSendMessageParams,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from "./rovo/agentConnector";
// Re-export Agent2Agent (A2A) protocol utilities
export {
  ACTIVE_TASK_STATES,
  formatAgentConnectorTaskResponse,
  getAllowedTransitions,
  isActiveState,
  isTerminalState,
  isValidAgentConnectorResponse,
  isValidStreamResponse,
  isValidTransition,
  TASK_STATE_TRANSITIONS,
  TERMINAL_TASK_STATES,
} from "./rovo/agentConnector";
// Re-export utility error handling
export type { ProblemDetails, Result } from "./util/errors";
export { err, ok, StandardError } from "./util/errors";
// Re-export JSON-RPC utilities
export type { JsonRpcRequest, JsonRpcResponse } from "./util/jsonrpc";
export {
  createErrorResponse,
  createSuccessResponse,
  isJsonRpcError,
  validateJsonRpcRequest,
} from "./util/jsonrpc";
