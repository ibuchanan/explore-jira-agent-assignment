# Auth-Required Resumes on Any User Input Initially

For the initial A2A Simulator happy path, any subsequent user input to the same task after an `auth-required` step with `waitForUserInput` is treated as approval. This avoids building a real approval UI while still demonstrating the A2A interruption and resumption lifecycle. Other scenarios may use `waitForUserInput` on unusual states as client test cases.

Post-hoc implementation note: the same first-pass resumption shortcut now applies to `input-required` pauses as well as `auth-required` pauses. `tasks/resubscribe` is not treated as user input; a resubscribe for a paused task reports the current task snapshot and closes until a later `message/send` resumes the task.
