# Separate Task State Updates from Content Updates

The streaming contract distinguishes Task State Updates from Content Updates. Task State Updates describe the task lifecycle state, while Content Updates carry incremental progress summaries, optional internal thinking, tool activity, and artifacts without implying a lifecycle transition. This avoids overloading repeated `working` status updates as a general event bus and keeps lifecycle handling independent from streamed content rendering.
