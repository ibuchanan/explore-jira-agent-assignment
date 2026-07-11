# Failure Details Use Artifacts Only When Reviewable

Failure completion uses a `failed` status message to communicate lifecycle failure. A failure Artifact is emitted only when there is reviewable diagnostic output worth preserving, such as a test report, unapplied patch, or structured failure analysis. Routine error text stays in the status message.
