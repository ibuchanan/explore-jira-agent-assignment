import {
  type Artifact,
  type Message,
  Role,
  TaskState,
  type TaskStatus,
} from "@a2a-js/sdk";
import { AgentEvent, type AgentExecutor } from "@a2a-js/sdk/server";
import {
  createRemoteA2aCompletedRecord,
  emitRemoteLogRecord,
  type RemoteLogRecordLogger,
} from "@forge-ahead/remote/logging";
import {
  invocationContextFromParts,
  type LoadedScenario,
  selectScenarioWithDiagnostic,
} from "./scenarios.js";

export type DiagnosticEvent = Record<string, unknown>;
export type Diagnostics = (event: DiagnosticEvent) => void;
export type Delay = (milliseconds: number) => Promise<void>;

type JiraCallbackCredentials = {
  apiBaseUrl: string;
  invokerId: string;
  tenantId: string;
  userToken: string;
};

type ScenarioSession = {
  canceled: boolean;
  contextId: string;
  invokerId: string;
  nextStep: number;
  scenario: LoadedScenario;
  sessionId: string;
  status?: TaskStatus;
  taskId: string;
  tenantId: string;
};

export type ScenarioRunnerOptions = {
  delay?: Delay;
  diagnostics?: Diagnostics;
  enableRealJiraCallbacks?: boolean;
  jiraFetch?: typeof fetch;
  remoteLogger?: RemoteLogRecordLogger;
  scenarios: LoadedScenario[];
};

const taskStates: Record<string, TaskState> = {
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  rejected: TaskState.TASK_STATE_REJECTED,
  failed: TaskState.TASK_STATE_FAILED,
  canceled: TaskState.TASK_STATE_CANCELED,
  "input-required": TaskState.TASK_STATE_INPUT_REQUIRED,
  "auth-required": TaskState.TASK_STATE_AUTH_REQUIRED,
  unknown: TaskState.TASK_STATE_UNSPECIFIED,
};

function agentMessage(
  taskId: string,
  contextId: string,
  text?: string,
): Message {
  return {
    role: Role.ROLE_AGENT,
    parts: text
      ? [
          {
            content: { $case: "text", value: text },
            filename: "",
            mediaType: "text/markdown",
            metadata: {},
          },
        ]
      : [],
    messageId: crypto.randomUUID(),
    taskId,
    contextId,
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };
}

function artifact(
  step: NonNullable<LoadedScenario["steps"][number]["artifact"]>,
): Artifact {
  return {
    artifactId: step.artifactId,
    name: step.name ?? "",
    description: step.description ?? "",
    parts: step.parts.map((part) => ({
      content: { $case: "text", value: part.text ?? "" },
      filename: "",
      mediaType: "text/markdown",
      metadata: {},
    })),
    metadata: step.metadata ?? {},
    extensions: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function jiraCallbackCredentials(requestContext: {
  context: { tenant?: string | undefined; user?: unknown };
}): JiraCallbackCredentials | undefined {
  const remoteContext = record(
    record(requestContext.context.user).forgeRemoteContext,
  );
  const fit = record(remoteContext.fit);
  const app = record(fit.app);
  const userToken = text(
    record(record(remoteContext.forwardedTokens).user).token,
  );
  const apiBaseUrl = text(app.apiBaseUrl ?? app.apiBaseURL);
  const invokerId = text(fit.sub);
  const tenantId = requestContext.context.tenant;
  return apiBaseUrl && userToken && invokerId && tenantId
    ? { apiBaseUrl, userToken, invokerId, tenantId }
    : undefined;
}

async function runJiraCallback(
  step: LoadedScenario["steps"][number],
  workItemId: string,
  credentials: JiraCallbackCredentials,
  jiraFetch: typeof fetch,
  accepted: boolean,
): Promise<"completed" | "auth-required" | "rejected" | "failed"> {
  const issuePath = `/rest/api/3/issue/${encodeURIComponent(workItemId)}`;
  const request = (path: string, init?: RequestInit) =>
    jiraFetch(
      new URL(`${issuePath}${path}`, credentials.apiBaseUrl).toString(),
      {
        ...init,
        headers: {
          Authorization: `Bearer ${credentials.userToken}`,
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
      },
    );
  const response =
    step.action === "read"
      ? await request("", { method: "GET" })
      : step.action === "comment"
        ? await request("/comment", {
            method: "POST",
            body: JSON.stringify({
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "mention", attrs: { id: credentials.invokerId } },
                      { type: "text", text: " Jira callback smoke test." },
                    ],
                  },
                ],
              },
            }),
          })
        : step.action === "transition" && step.transitionId
          ? await request("/transitions", {
              method: "POST",
              body: JSON.stringify({ transition: { id: step.transitionId } }),
            })
          : undefined;
  if (!response) return "rejected";
  if (response.status === 401 || response.status === 403)
    return "auth-required";
  return response.ok ? "completed" : accepted ? "failed" : "rejected";
}

function terminal(
  logger: RemoteLogRecordLogger | undefined,
  taskId: string,
  contextId: string,
  state: TaskState,
): void {
  if (logger)
    emitRemoteLogRecord(
      logger,
      createRemoteA2aCompletedRecord({
        taskId,
        contextId,
        state: TaskState[state],
      }),
    );
}

export function createScenarioRunner({
  scenarios,
  diagnostics = () => {},
  delay = async () => {},
  enableRealJiraCallbacks = false,
  jiraFetch = fetch,
  remoteLogger,
}: ScenarioRunnerOptions): AgentExecutor {
  const sessions = new Map<string, ScenarioSession>();
  const publishStatus = (
    eventBus: { publish(event: unknown): void },
    taskId: string,
    contextId: string,
    task: unknown,
    index: number,
    status: TaskStatus,
  ) => {
    if (index === 0)
      eventBus.publish(
        AgentEvent.task(
          task
            ? ({ ...(task as object), status } as never)
            : {
                id: taskId,
                contextId,
                artifacts: [],
                history: [],
                metadata: {},
                status,
              },
        ),
      );
    else
      eventBus.publish(
        AgentEvent.statusUpdate({ taskId, contextId, status, metadata: {} }),
      );
  };
  return {
    async execute(requestContext, eventBus) {
      const { taskId, contextId, task, userMessage } = requestContext;
      const existing = sessions.get(taskId);
      const invocationContext = invocationContextFromParts(userMessage.parts);
      const trustedCredentials = jiraCallbackCredentials(requestContext);
      const selection = selectScenarioWithDiagnostic(
        scenarios,
        invocationContext,
      );
      const scenario = existing?.scenario ?? selection.scenario;
      const session = existing ?? {
        canceled: false,
        contextId,
        invokerId: trustedCredentials?.invokerId ?? invocationContext.invokerId,
        nextStep: 0,
        scenario,
        sessionId: crypto.randomUUID(),
        taskId,
        tenantId: trustedCredentials?.tenantId ?? invocationContext.tenantId,
      };
      sessions.set(taskId, session);
      diagnostics({
        event: "scenario-selected",
        taskId: session.taskId,
        contextId: session.contextId,
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        invokerId: session.invokerId,
        scenarioId: scenario.id,
        selection: existing ? "resume" : selection.category,
        workItemAvailability: invocationContext.workItem.availability,
        commentAvailability: invocationContext.comment.availability,
        callbackReadiness: scenario.steps.some(
          (step) => step.event === "jira-callback",
        )
          ? enableRealJiraCallbacks
            ? "real-enabled"
            : "simulated"
          : "not-configured",
      });
      for (
        let index = session.nextStep;
        index < scenario.steps.length;
        index++
      ) {
        const step = scenario.steps[index];
        if (!step) return;
        if (step.delayMs) await delay(step.delayMs);
        if (session.canceled) return;
        session.nextStep = index + 1;
        if (step.event === "artifact-update" && step.artifact) {
          eventBus.publish(
            AgentEvent.artifactUpdate({
              taskId,
              contextId,
              artifact: artifact(step.artifact),
              append: step.append === true,
              lastChunk: step.lastChunk === true,
              metadata: {},
            }),
          );
          continue;
        }
        if (step.event === "jira-callback" && step.action) {
          const unavailable =
            invocationContext.workItem.availability !== "available" ||
            !session.tenantId ||
            !session.invokerId;
          const credentials =
            enableRealJiraCallbacks && step.real === true && trustedCredentials;
          const result = unavailable
            ? "context-unavailable"
            : credentials
              ? await runJiraCallback(
                  step,
                  invocationContext.workItem.id ?? "",
                  credentials,
                  jiraFetch,
                  session.status?.state === TaskState.TASK_STATE_WORKING,
                ).catch(() =>
                  session.status?.state === TaskState.TASK_STATE_WORKING
                    ? "failed"
                    : "rejected",
                )
              : (step.result ?? "simulated");
          const state =
            result === "auth-required"
              ? TaskState.TASK_STATE_AUTH_REQUIRED
              : result === "rejected"
                ? TaskState.TASK_STATE_REJECTED
                : result === "failed"
                  ? TaskState.TASK_STATE_FAILED
                  : (session.status?.state ?? TaskState.TASK_STATE_WORKING);
          const status = {
            state,
            message: agentMessage(
              taskId,
              contextId,
              step.message ??
                (result === "context-unavailable"
                  ? "Simulated Jira callback skipped because the active invocation context is unavailable; no Jira action was performed."
                  : `Simulated Jira ${step.action} callback (${result}); no Jira action was performed.`),
            ),
            timestamp: new Date().toISOString(),
          };
          session.status = status;
          diagnostics({
            event: "jira-callback",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            invokerId: session.invokerId,
            ...(invocationContext.workItem.id
              ? { workItemId: invocationContext.workItem.id }
              : {}),
            scenarioId: scenario.id,
            action: step.action,
            result,
          });
          publishStatus(eventBus, taskId, contextId, task, index, status);
          if (result === "auth-required") return;
          if (result === "rejected" || result === "failed") {
            terminal(remoteLogger, taskId, contextId, state);
            sessions.delete(taskId);
            return;
          }
          continue;
        }
        if (step.event !== "status-update") {
          diagnostics({
            event: "compliance-warning",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            warning: "unsupported-scenario-event",
          });
          continue;
        }
        const state = step.state
          ? taskStates[step.state]
          : session.status?.state;
        if (!state) {
          diagnostics({
            event: "compliance-warning",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            warning: "unsupported-task-state",
          });
          continue;
        }
        const status = {
          state,
          message: agentMessage(taskId, contextId, step.message),
          timestamp: new Date().toISOString(),
        };
        session.status = status;
        diagnostics({
          event: "lifecycle",
          taskId: session.taskId,
          contextId: session.contextId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          scenarioId: scenario.id,
          state: step.state ?? "unknown",
        });
        publishStatus(eventBus, taskId, contextId, task, index, status);
        if (step.waitForUserInput) {
          diagnostics({
            event: "paused",
            taskId: session.taskId,
            contextId: session.contextId,
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            scenarioId: scenario.id,
            state: step.state ?? "unknown",
          });
          return;
        }
        if (
          [
            TaskState.TASK_STATE_COMPLETED,
            TaskState.TASK_STATE_REJECTED,
            TaskState.TASK_STATE_FAILED,
            TaskState.TASK_STATE_CANCELED,
          ].includes(state)
        ) {
          terminal(remoteLogger, taskId, contextId, state);
          sessions.delete(taskId);
          return;
        }
      }
    },
    async cancelTask(taskId, eventBus) {
      const session = sessions.get(taskId);
      if (!session || session.canceled) return;
      session.canceled = true;
      diagnostics({
        event: "canceled",
        taskId: session.taskId,
        contextId: session.contextId,
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        scenarioId: session.scenario.id,
      });
      terminal(
        remoteLogger,
        taskId,
        session.contextId,
        TaskState.TASK_STATE_CANCELED,
      );
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId: session.contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: agentMessage(taskId, session.contextId, "Task canceled."),
            timestamp: new Date().toISOString(),
          },
          metadata: {},
        }),
      );
      sessions.delete(taskId);
    },
  };
}
