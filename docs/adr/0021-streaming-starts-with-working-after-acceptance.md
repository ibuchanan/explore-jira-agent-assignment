# Streaming Starts With Working After Acceptance

For streaming `message/send`, the Reference Implementation begins with `working` once the Remote Agent accepts the task, or with an immediate interrupted or terminal state if the task cannot start. For polling/non-streaming `message/send`, the Reference Implementation may create the task in `submitted` and then transition to `working`. `submitted` remains useful for task creation and polling flows, but is not the normal first streaming state.
