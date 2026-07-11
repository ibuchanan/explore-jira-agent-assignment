# Resumption Emits Working Before Content

After a task resumes from `input-required` or `auth-required`, the Reference Implementation emits a `working` Task State Update before additional Content Updates or Artifact updates. This makes the lifecycle transition explicit before new progress or outputs arrive.
