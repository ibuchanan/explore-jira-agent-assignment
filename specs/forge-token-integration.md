# Using Forge Tokens in Remote Backend

## Overview
The remote backend service must use Forge Invocation Tokens (FIT) to authenticate requests and interact with Atlassian systems, including direct Jira API calls, KVS secret retrieval, and MCP configuration.

## Description
The backend service receives FIT tokens from the Forge app and uses them to perform authenticated operations on behalf of the app. This enables the remote service to act with the app's permissions while maintaining the security model of Atlassian's platform.

## Key Requirements

### FIT Token Parsing and Validation
- **Middleware function**: Parse and validate incoming FIT tokens
- **Token extraction**: Retrieve FIT from request headers or body
- **Validation**: Verify token signature and expiration
- **Error handling**: Clear rejection of invalid/expired tokens
- **Logging**: Log Cloud ID for observability (not sensitive data)

### Extract Key Information from FIT Token
- **`App.ID`**: Forge app identifier
- **`App.Environment.ID`**: Environment (dev/prod)
  - Use case: Build configuration page links for admin troubleshooting
- **`App.APIBaseURL`**: Base URL for Jira and Atlassian API calls
  - Use case: Direct HTTP calls to Jira REST API
  - Use case: Forge KVS secret retrieval endpoints
- **`Context.CloudID`**: Tenant identifier
  - Use case: Multi-tenant logging and audit trails
- **`Principal`**: Atlassian account ID (invoker)
  - Use case: Jira work item comment mentions
  - Use case: Per-user secret overrides
  - Use case: Attribution in logs and audit trails

### Direct Jira API Calls
- **Endpoint**: Use `App.APIBaseURL` + `/rest/api/3/...`
- **Authentication**: Use FIT token in Authorization header
- **Operations**:
  - Fetch issue details
  - Create/update comments
  - Transition issues
  - Query fields
- **System token**: Use system/app credentials for certain operations (e.g., posting system comments)

### Jira Work Item Comments with Mentions
- **Format**: ADF (Atlassian Document Format)
- **Mention syntax**: Include `mention` type with account ID
- **Use case**: Comment mentioning the user with agent status updates
- **Example**: "[@User](account-id) Waiting for your input..."
- **Authentication**: Post as app using system token (not user token)

### Forge KVS Secret Retrieval
- **Endpoint**: Forge `/v1/get-secret` endpoint
- **Authentication**: Use FIT token
- **Operations**: Fetch encrypted secrets stored by admin
- **Use case**: Retrieve Remote Agent API keys, GitHub tokens
- **Fallback handling**: Support multi-level secret lookup (per-user → tenant)

### Configuring MCP with Forge Auth
- **Use case**: Pass Forge-authenticated credentials to Remote Agent MCP integration
- **Token scope**: MCP tools can use Jira API via Forge auth
- **Configuration**: Set up MCP with Forge API base URL and token handling
- **Security**: Ensure token lifecycle matches MCP session lifetime

## Success Criteria
- [ ] FIT token parsing works for all supported environments
- [ ] Token validation rejects invalid/expired tokens
- [ ] Direct Jira API calls succeed with FIT authentication
- [ ] Comments can mention users by account ID
- [ ] KVS secret retrieval uses FIT token correctly
- [ ] Multi-tenant isolation is maintained
- [ ] All Jira operations are properly logged
- [ ] MCP can use Forge auth for tool invocations
- [ ] Clear error messages for auth failures

## Security Considerations
- Validate token signature before using claims
- Check token expiration
- Log sensitive operations (not sensitive values)
- Support token rotation
- Isolate tokens per request (no cross-contamination)
- Use HTTPS for all API calls

## Implementation Notes
- Reference: `internal/a2a/server.go` middleware (lines 328-418)
- FIT token structure follows JWT standards
- Multiple FIT tokens may be needed for different services
- Token expires after session completes

## References
- Forge Invocation Token (FIT) documentation
- Jira REST API v3 documentation
- Forge KVS secret endpoints
- ADF (Atlassian Document Format) specification
