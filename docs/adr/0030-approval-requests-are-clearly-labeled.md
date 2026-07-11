# Approval Requests Are Clearly Labeled

The Reference Implementation labels Approval Request messages clearly in text, with labels such as `Approval required:` treated as illustrative rather than required protocol strings. Approval Requests are paired with `auth-required` and ask the user to take action, so they should be more explicit than ordinary progress or tool telemetry.
