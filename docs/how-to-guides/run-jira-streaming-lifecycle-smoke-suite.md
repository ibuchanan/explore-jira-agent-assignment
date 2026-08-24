# How to run the Jira streaming lifecycle smoke suite

Use this procedure after deploying the direct Forge connector to verify the Jira
presentation behaviors that the local A2A tests cannot observe. This is a live,
operator-run smoke suite: it does not substitute for the deterministic tests in
`apps/remote/test/`.

## Before you start

Prepare the development integration in three terminals as described in
[Development](../../DEVELOPMENT.md):

1. Start the remote with `npm run remote:start`.
2. Start the tunnel and deploy with
   `npm run forge:deploy:tunnel:approve-system-user-change`.
3. Install the development app with `npm run forge:install` if it is not already
   installed.

Keep the remote and tunnel terminals open for the entire suite. In the remote
log, confirm the Jira invocation records `SendStreamingMessage`. Stop and
investigate if Jira instead invokes `SendMessage`; this suite validates the
streaming connector path.

Create one evidence record for the whole run before starting:

| Field | Record |
| --- | --- |
| Date and operator | |
| Jira site and Forge environment | |
| Forge app ID or deployment version | |
| Tunnel URL (do not share it outside the approved test record) | |
| Remote log evidence for `SendStreamingMessage` | |

For each case below, record the **Task URL or ID**, the visible event order,
and pass/fail result. Capture screenshots or approved task links according to
your team's data-handling policy.

## Verify ordered progress and review artifacts

1. In Jira's Rovo experience, invoke **Agent Simulator** with:

   ```text
   Fix the login bug
   ```

2. Observe the initial `working` delivery-start update and the delivery-plan
   approval pause.
3. Reply **Approve delivery plan**, then reply **Approve technical approach**
   when prompted.
4. Verify Jira presents the following in source order:
   - implementation progress;
   - the two chunks of **Proposed login session fix**;
   - **Verification report**; and
   - **Review-ready delivery handoff**, followed by the terminal completion.
5. Record the Task URL or ID and the observed order. Mark this case failed if
   Jira omits, reorders, or collapses review artifacts so their source order
   cannot be verified.

## Verify pause and same-task resumption

1. Invoke **Agent Simulator** with:

   ```text
   Push the hotfix to the repository
   ```

2. Wait for the `auth-required` approval prompt and record its Task URL or ID.
3. Send a follow-up message from that same task, such as `Approved`.
4. Verify Jira continues the same task, rather than creating a new one, and
   displays `working` before the resumed progress and terminal completion.
5. Record the Task URL or ID, the paused state, the resumed `working` update,
   and the final state.

## Verify cancellation is terminal

1. Invoke **Agent Simulator** with:

   ```text
   Start the long-running repository migration
   ```

2. Wait until Jira displays initial working progress, then cancel the task.
3. Verify the terminal task state is `canceled`. If the prior migration artifact
   is visible, record that it remains attached to the task.
4. Wait at least five seconds, which exceeds the scenario's remaining delayed
   updates. Verify there is no later completion after the `canceled` state.
5. Record the Task URL or ID, cancellation time, final state, and the result of
   the post-cancellation wait.

## Record the result

Add the following result table to the evidence record:

| Case | Task URL or ID | Required observation | Result | Notes |
| --- | --- | --- | --- | --- |
| Streaming request | | Remote log contains `SendStreamingMessage` | | |
| Coding presentation | | Progress and review artifacts appear in source order | | |
| Pause/resume | | Same task emits `working` before subsequent output | | |
| Cancellation | | Terminal `canceled`; no later completion | | |

Do not claim that task state survives a remote restart, tunnel loss, Forge
redeployment, or reinstallation. This development sample uses in-memory task
state; restart/redeployment continuity is not claimed.

If a case fails, preserve its Task URL or ID and relevant remote log excerpt,
then create a targeted follow-up. Do not extend this smoke suite into a relay,
persistent event store, or durable task-store design.
