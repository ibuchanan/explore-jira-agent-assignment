# Interrupted Tasks Resume the Same Task

When a task reaches `input-required` or `auth-required`, the user's response resumes the same task by transitioning it back to `working`. The interruption is part of the same unit of work, so task identity, status history, and artifacts remain connected.
