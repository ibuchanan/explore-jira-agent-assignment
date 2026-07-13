/**
 * Jira remote-agent JSON-RPC method shapes.
 *
 * Generic JSON-RPC envelope helpers live in `util/jsonrpc`; this module narrows
 * the method names and params used by the Rovo agent connector integration.
 */

import type { Message, Task } from "./a2aContract";

/**
 * Parameters for the message/send JSON-RPC method.
 */
export interface SendMessageParams {
  message: Message;
}

/**
 * Parameters for the tasks/get JSON-RPC method. Jira sends the standard A2A
 * `TaskQueryParams` shape (`id`, optional `historyLength`), not `taskId`.
 */
export interface GetTaskParams {
  id: string;
  historyLength?: number;
}

/**
 * Parameters for the tasks/cancel JSON-RPC method. Jira sends the standard
 * A2A `TaskIdParams` shape (`id`), not `taskId`.
 */
export interface CancelTaskParams {
  id: string;
}

/**
 * Parameters for the tasks/resubscribe JSON-RPC method. Jira sends the
 * standard A2A `TaskIdParams` shape (`id`), not `taskId`.
 */
export interface ResubscribeTaskParams {
  id: string;
}

export type AgentConnectorMethod =
  | "message/send"
  | "tasks/get"
  | "tasks/cancel"
  | "tasks/resubscribe";

/**
 * JSON-RPC 2.0 Request structure for Agent Connector.
 *
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface AgentConnectorRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: AgentConnectorMethod;
  params:
    | SendMessageParams
    | GetTaskParams
    | CancelTaskParams
    | ResubscribeTaskParams;
}

/**
 * JSON-RPC 2.0 Response structure for Agent Connector.
 *
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface AgentConnectorResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: Task;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
