# Jira Remote Agent Assignment

This context defines the language for Jira remote-agent task execution and streaming state updates.

## Language

**Remote Agent**:
An implementing agent runtime that receives Jira-originated tasks through the remote-agent integration. A Remote Agent can be backed by any provider or execution system.
_Avoid_: Provider agent, model-specific agent

**Coding Remote Agent**:
A Remote Agent that satisfies Jira work items by inspecting, editing, testing, or otherwise operating on a code repository. The agent is unnamed in the Reference Implementation and should not be tied to a specific coding-agent provider.
_Avoid_: Work item summarizer, named coding provider

**A2A Simulator**:
A general, deterministic scenario runner that emits A2A-compatible task, status, message, and artifact updates without connecting to a real agent runtime. It is reusable beyond Jira remote-agent demos.
_Avoid_: Jira-only simulator, coding-agent-only simulator

**Simulated Coding Remote Agent**:
A Coding Remote Agent scenario set for the A2A Simulator. It demonstrates the Jira-to-Remote-Agent streaming contract through scripted repository inspection, tool activity, artifacts, interruption, and completion.
_Avoid_: Knock-knock demo, real coding runtime

**Simulation Scenario**:
A human-readable, editable YAML script that drives the A2A Simulator's streamed behavior for a specific kind of task. Scenarios should use explicit A2A-oriented fields and be stored as data rather than hardcoded control flow.
_Avoid_: Hardcoded branch, hidden fixture

**Scenario Matching**:
The process of choosing a Simulation Scenario by matching the starting task text or context with ordered, case-insensitive `contains` phrase rules. Matching should be deterministic and understandable to people editing scenarios.
In the current Reference Implementation, Scenario Matching only uses the joined text parts from the starting message; matching on structured context remains a known implementation gap.
_Avoid_: Random scenario selection, opaque routing

**Default Scenario**:
The Simulation Scenario used when no ordered matching rule matches the starting task text or context. It should provide a generic happy path and be visible in logs or status text.
_Avoid_: Task rejection for no match

**Compliance Warning**:
A non-blocking ProblemDetails-shaped log entry emitted when a Simulation Scenario appears non-compliant with A2A or Jira remote-agent expectations. It is an implementation log, not part of the simulated A2A stream. Its `type` should point to the most relevant public specification URL available, using coarse-grained spec URLs for broad warnings and specific anchors for fine-grained warnings.
_Avoid_: String warning prefix, thrown validation error

**Reference Implementation**:
The sample Jira remote-agent integration in this repository. It prioritizes visibility and explainability for implementers, but its operational choices are not automatically recommendations for every Remote Agent.
_Avoid_: Normative implementation, production baseline

**Thinking Process**:
A safe, user-visible progress summary of what the agent is doing while a task runs. It may be derived from runtime events, but it is not raw model reasoning.
_Avoid_: Progress text, agent thoughts

**Internal Thinking**:
Raw model or runtime reasoning that an implementer may choose to expose through this interface as an explicit capability. It is distinct from safe progress summaries and, in the Reference Implementation, is shown when supported rather than hidden behind additional configuration.
_Avoid_: Thinking process, progress summary

**Task State Update**:
A streamed lifecycle signal that reports where a task is in the agent execution state machine. It should only be used when the task's lifecycle state is being asserted or changed.
_Avoid_: Status update for arbitrary content

**Content Update**:
A streamed payload that carries incremental content produced during task execution, such as a Thinking Process, Internal Thinking, tool activity, or artifact data. It does not imply a task lifecycle transition by itself.
_Avoid_: State update, status update

**Tool Activity**:
A Content Update in status/message content that reports a tool invocation, tool result, or related execution detail. It describes agent activity and is not a first-class Jira task output unless the agent emits an Artifact.
_Avoid_: Artifact, task state

**Artifact**:
A formal A2A task output produced during task execution that can be rendered, reviewed, persisted, or referenced after it is streamed. Anything intended as a task output for Jira or user review must be emitted as an Artifact.
_Avoid_: Tool result, log output

**Artifact Kind**:
A conventional metadata value that identifies what kind of coding-agent output an Artifact represents, such as `patch`, `pull-request`, `test-report`, or `implementation-summary`. The Reference Implementation does not define a required metadata key schema.
_Avoid_: Display name, description text

**A2A Task State**:
One of the formal task lifecycle states defined by the A2A-compatible state model used by Jira remote agents. This project does not create custom task states outside that model.
_Avoid_: Custom state, feature state

**Rejected Task**:
A task the Remote Agent refuses or cannot accept before execution begins, such as unsupported work, invalid task shape, or missing authorization required for task acceptance.
_Avoid_: Runtime failure

**Failed Task**:
A task the Remote Agent accepted but could not complete because execution encountered an unrecoverable problem.
_Avoid_: Task rejection

**Unknown Task State**:
An exceptional fallback for externally observed, missing, or invalid task state. It is not intentionally emitted during normal Remote Agent execution.
_Avoid_: Pending state, unsure state

**Remote Agent Signal**:
A provider-specific execution event emitted by a Remote Agent while handling a task. The reference implementation maps these signals into A2A Task State Updates and Content Updates without making provider-specific signal names part of the feature spec.
_Avoid_: Provider event, direct state transition

**Tool Approval**:
A feature-level interaction where task execution pauses until a user authorizes a tool or capability. In this project it is represented by the formal A2A `auth-required` task state.
_Avoid_: Custom tool-approval state

**Recoverable Authorization Need**:
A task interruption where additional user authorization can allow execution to continue. It is represented by `auth-required`, whether it occurs during initial acceptance or after execution has begun.
_Avoid_: Task failure, task rejection

**Input Need**:
A task interruption where the Remote Agent needs a user decision or clarification about the work, such as repository, branch, acceptance criteria, or an ambiguous requirement. It is represented by `input-required`.
_Avoid_: Authorization need, approval request

**Approval Request**:
A Content Update that explains a Tool Approval pause, including the requested tool or capability, the user-facing reason, risk or permission details, and any UI metadata needed to render the approval action.
_Avoid_: Auth-required state, tool approval state

**A2A-Visible Event**:
A Task State Update, Content Update, or Artifact update that is emitted to Jira through the A2A streaming interface. A2A-visible events are the integration boundary for streamed behavior.
_Avoid_: Internal log event, transient update

**Stream Replay**:
Jira-controlled stream recovery after a reconnect or `tasks/resubscribe`. The reference implementation follows Jira's existing behavior and does not introduce a custom event-store or cursor contract.
_Avoid_: Custom replay log, integration-defined cursor
