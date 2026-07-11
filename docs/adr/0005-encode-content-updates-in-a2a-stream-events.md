# Encode Content Updates in A2A Stream Events

The domain model distinguishes Content Updates from Task State Updates, but the wire contract remains A2A-compatible. Non-artifact Content Updates are encoded in `TaskStatusUpdateEvent.message`, while Artifacts are encoded as `TaskArtifactUpdateEvent`. This preserves the conceptual distinction without introducing custom stream event types outside the A2A streaming model.
