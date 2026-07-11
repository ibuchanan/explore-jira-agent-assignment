# Artifacts May Be Complete or Chunked

The streaming spec allows Artifacts to be emitted as complete `TaskArtifactUpdateEvent` payloads or as incremental chunks using A2A's `append` and `lastChunk` fields. The Reference Implementation can start with complete artifacts for simple outputs while preserving a path for large test reports, patches, or implementation summaries to stream incrementally.
