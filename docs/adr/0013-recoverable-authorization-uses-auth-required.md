# Recoverable Authorization Uses Auth-Required

When missing repository or tool authorization can be fixed by user action, the Reference Implementation uses `auth-required` with an Approval Request rather than `rejected` or `failed`. If the task cannot be accepted and no recoverable authorization path exists, it is `rejected`; if authorization is lost after acceptance and cannot be recovered, it is `failed`.
