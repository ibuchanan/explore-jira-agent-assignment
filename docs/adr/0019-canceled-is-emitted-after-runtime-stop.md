# Canceled Is Emitted After Runtime Stop

The Reference Implementation does not emit terminal `canceled` immediately on cancellation request. It first asks the Remote Agent runtime to stop, then emits `canceled` once the runtime acknowledges stop or the integration force-stops or abandons the task. While cancellation is in progress, the stream may emit non-final status/message content such as "Canceling..." while keeping the prior state where possible; it does not transition to `working` or invent a custom canceling state just to report cancellation progress.
