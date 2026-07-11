# Markdown Support in Agent Messages

## Overview
Agent messages must support rich markdown formatting, including accordions with summary/details, to communicate complex information clearly to users.

## Description
The application should render markdown-formatted content in agent messages, allowing agents to structure information hierarchically and use interactive components like accordions (details/summary) for better UX.

## Key Requirements

### Markdown Support
- **Basic formatting**: Bold, italic, underline, strikethrough
- **Lists**: Unordered and ordered lists with proper nesting
- **Code blocks**: Syntax-highlighted code with language specification
- **Links**: Clickable links to external resources
- **Headings**: H1-H6 for content structure
- **Blockquotes**: For emphasizing quoted text
- **Horizontal rules**: To separate sections

### Interactive Components
- **Accordions**: Use `<details>` and `<summary>` HTML elements
  - Collapsed by default for secondary information
  - Expandable titles with rich content inside
  - Useful for tool invocation details, debugging info, or supplementary context

### Content Types in Messages
- Agent status text
- Tool invocation summaries
- Tool result details
- Thinking process explanation
- Error messages with context

## Success Criteria
- [ ] Agent messages render markdown formatting correctly
- [ ] Accordion/details components display and toggle properly
- [ ] Nested lists and code blocks are supported
- [ ] Links are clickable and functional
- [ ] Complex tool invocations can be collapsed/expanded
- [ ] Mobile/responsive rendering works for accordions

## Implementation Notes
- Use HTML conversion layer for markdown → display format
- Consider using standard markdown parser with HTML sanitization
- Details/summary should be accessible (ARIA labels, keyboard navigation)
- Ensure backward compatibility with plain text messages

## References
- Confluence HTML format reference (details/summary elements)
- A2A TextPart content structure
- Tool result formatting in agent-bridge
