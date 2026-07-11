# Unknown Is Not a Normal Execution State

The Reference Implementation treats `unknown` as an exceptional fallback for externally observed, missing, or invalid task state. It does not intentionally emit `unknown` during normal Remote Agent execution; normal runtime mapping uses explicit A2A task states.
