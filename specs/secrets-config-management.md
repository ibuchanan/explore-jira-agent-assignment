# Secrets and Configuration Management

## Overview
The Forge app must securely manage secrets (API keys, tokens) and configuration values using Forge KVS, with support for both tenant-level and per-user overrides.

## Description
The application needs a secure configuration system that stores sensitive credentials and configuration parameters in Forge KVS. The backend service retrieves these secrets using Forge's secret endpoints, supporting multi-level overrides for flexible credential management.

## Key Requirements

### Tenant-Level Secrets
- **Storage**: Use `@forge/kvs` for persistent, encrypted storage
- **Secrets managed**:
  - Remote Agent API key
  - GitHub access tokens
  - Remote Agent session configuration variables
- **Retrieval**: Backend service fetches via Forge `/v1/get-secret` endpoints
- **Scope**: Applied to all users in the tenant by default

### Per-User Overrides
- **User-specific secrets**: Support account-ID-based secret naming convention
- **Lookup pattern**: Use invoker's account ID (from FIT token principal) to fetch user-specific secret
- **Fallback logic**: Use user secret if present, otherwise fall back to tenant secret
- **Use cases**:
  - Individual GitHub token for user-specific integrations
  - User's own external API credentials
  - Personalized authentication configurations

### Admin Configuration UI
- **Admin panel**: Configure secrets through Forge app admin pages
- **Credentials to configure**:
  - Remote Agent API key
  - GitHub tokens
  - Remote Agent parameters (model, max tokens, etc.)
- **Usability**: Simple form-based interface for non-technical admins
- **Security**: Secrets masked in UI, no logging of sensitive values

### Backend Integration
- **FIT token validation**: Parse Forge Invocation Token to get:
  - `Principal` (account ID for user lookups)
  - `App.APIBaseURL` (for Jira API calls)
  - `Context.CloudID` (for tenant identification)
- **Multi-level fetch**:
  1. Check for per-user secret (using Principal account ID)
  2. Fall back to tenant-level secret
  3. Handle missing configuration gracefully
- **Error handling**: Clear messages when required secrets are missing

## Success Criteria
- [ ] Secrets stored encrypted in Forge KVS
- [ ] Admin UI allows configuration of all required secrets
- [ ] Backend retrieves secrets using FIT token authentication
- [ ] Per-user secret override works correctly
- [ ] Fallback to tenant secrets functions properly
- [ ] No secrets logged or exposed in error messages
- [ ] Supports GitHub and Remote Agent credential rotation
- [ ] Clear admin documentation for setup

## Security Considerations
- Always use Forge's encrypted KVS endpoints
- Never store secrets in code or configuration files
- Implement proper access control in admin UI
- Audit secret access in logs
- Support credential rotation without service restart

## Implementation Notes
- Reference: Remote Agent admin configuration code
- Use Forge KVS API: `@forge/kvs`
- Backend: `internal/forge/storage/kvs.go` pattern
- Secret naming: `{secret-name}` for tenant, `{user-account-id}:{secret-name}` for user overrides

## References
- Forge KVS API documentation
- `/v1/get-secret` endpoint documentation
- FIT token structure and claims
