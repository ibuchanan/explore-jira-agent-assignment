# Jira Work Item Context Extraction

## Overview
The remote backend must extract and identify Jira work item details and trigger comment information from A2A messages, then enrich agent context with this information for better decision-making.

## Description
When a user initiates an agent session through a Jira work item (issue panel, comment mention, etc.), the backend extracts relevant context from the A2A data and presents it to the agent in a structured, human-readable format. This allows the agent to understand what issue it's working on and what prompted the session.

## Key Requirements

### Extracting Work Item Details from A2A Message
- **Source**: Parse A2A data parts from the initial session request
- **Issue fields to extract**:
  - `issue.id`: Numeric issue ID
  - `issue.fields.summary`: Issue title/summary
  - `issue.fields.description`: Full issue description
  - Additional fields as needed for context
- **Fallback handling**: Gracefully handle missing fields (some tenants may restrict data)

### Extracting Comment Trigger Context
- **Conditional extraction**: Only present when session triggered by comment mention
- **Comment fields**:
  - `comment.id`: Comment identifier
  - `comment.body`: Full comment text in ADF or plain text
- **Use case**: Understand what specific feedback or question prompted the session

### Rendering Context for Agent
- **Format**: Markdown-like string representation
- **Structure**:
  ```
  [... any A2A text parts ...]
  
  ## Jira work item details
  
  **ID:** PROJ-42
  **Summary:** Add dark mode
  **Description:** Users want a dark theme.
  
  ## Comment details
  
  **ID:** 987
  **Comment text:** Looks good to me!
  ```
- **Formatting**: Clear headings, bold labels, readable layout
- **Escaping**: Properly escape special characters in descriptions

### Work Item Availability
- **Always available**: When triggered from issue panel/detail
- **Optional**: May be missing if:
  - Session triggered from other contexts
  - Tenant restricts issue visibility
  - User lacks issue access
- **Graceful handling**: Continue session without issue context if unavailable

### Comment Context Availability
- **Present when**: Session triggered by comment mention/reply
- **Absent when**: Direct issue panel trigger or other context
- **Conditional rendering**: Only include "Comment details" section if comment data exists

## Success Criteria
- [ ] Work item ID is correctly extracted from A2A message
- [ ] Issue summary and description are parsed properly
- [ ] Comment context is extracted when available
- [ ] Markdown rendering is clean and readable
- [ ] Agent receives full context for decision-making
- [ ] Missing fields don't cause errors
- [ ] Special characters in descriptions are handled safely
- [ ] Comment mention context improves agent understanding

## Implementation Notes
- Reference: Remote Agent executor request-building code
- A2A data parts structure contains the issue/comment JSON
- Render to string before passing to the Remote Agent prompt or task input
- Preserve formatting from original descriptions where possible

## Data Structure Example
```json
{
  "issue": {
    "id": 12345,
    "fields": {
      "summary": "Add dark mode",
      "description": "Users want a dark theme. Current UI only supports light mode."
    }
  },
  "comment": {
    "id": 987,
    "body": "Looks good to me! Can we also add a schedule for when dark mode comes out?"
  }
}
```

## Related Features
- Jira Context Integration: Provides work item details
- Markdown Support in Messages: Renders formatted context
- Forge Token Integration: Uses auth to fetch additional context if needed

## References
- Jira REST API v3 - Issue fields structure
- A2A protocol - data parts specification
- ADF (Atlassian Document Format) for comment bodies
