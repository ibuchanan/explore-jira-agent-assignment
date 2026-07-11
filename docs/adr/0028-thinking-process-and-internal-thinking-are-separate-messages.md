# Thinking Process and Internal Thinking Are Separate Messages

When both Thinking Process summaries and Internal Thinking are available, the Reference Implementation streams them as separate `TaskStatusUpdateEvent.message` updates. Thinking Process summaries remain ordinary progress messages without a required label, while Internal Thinking is visibly labeled in text. This preserves the semantic difference between safe user-visible progress and raw internal thinking while keeping the sample fully visible.
