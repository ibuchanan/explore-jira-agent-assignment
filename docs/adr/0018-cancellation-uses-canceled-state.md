# Cancellation Uses Canceled State

When Jira or the user requests cancellation and the task stops because of that request, the Reference Implementation emits the A2A `canceled` terminal state. Internal runtime termination details do not turn a requested cancellation into `failed`; they remain diagnostics or status text if useful.
