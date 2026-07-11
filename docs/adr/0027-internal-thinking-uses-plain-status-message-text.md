# Internal Thinking Uses Plain Status Message Text

The Reference Implementation streams Internal Thinking as plain text in `TaskStatusUpdateEvent.message` when the Remote Agent supports raw internal thinking. Internal Thinking is visibly labeled in the message text, with labels such as `Internal thinking:` treated as illustrative rather than required protocol strings. The sample does not define a custom message-part schema or metadata contract for distinguishing internal thinking from other status message content.
