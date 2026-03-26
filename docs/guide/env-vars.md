# Environment Variables

## Reference

| Variable | Description |
|----------|-------------|
| `API2MCP_SPEC_URL` | OpenAPI spec URL or file path (alternative to positional argument) |
| `API2MCP_BASE_URL` | Override base URL from spec's `servers[0].url` |
| `API2MCP_BEARER_TOKEN` | Bearer token → `Authorization: Bearer <token>` |
| `API2MCP_API_KEY` | API key → header name from `securitySchemes` in spec |
| `API2MCP_AUTH_TOKEN` | Raw `Authorization` header value |
| `API2MCP_AUTH_TYPE` | Auth type — currently supports `jwt-password` |
| `API2MCP_AUTH_LOGIN_URL` | JWT login endpoint URL |
| `API2MCP_USERNAME` | Username for JWT password auth |
| `API2MCP_PASSWORD` | Password for JWT password auth |
| `API2MCP_AUTH_USERNAME_FIELD` | Request body field for username (default: `username`) |
| `API2MCP_AUTH_PASSWORD_FIELD` | Request body field for password (default: `password`) |
| `API2MCP_AUTH_TOKEN_PATH` | Path to JWT in login response (default: `token`) |
| `API2MCP_AUTH_REFRESH_URL` | JWT refresh endpoint URL |

## Legacy aliases

Still supported for backward compatibility:

| Legacy variable | Current variable |
|-----------------|-----------------|
| `OPENAPI_SPEC_URL` | `API2MCP_SPEC_URL` |
| `OPENAPI_BEARER_TOKEN` | `API2MCP_BEARER_TOKEN` |
| `OPENAPI_API_KEY` | `API2MCP_API_KEY` |

## Auth priority

When multiple env vars or sources are set, the following priority applies (highest wins):

```
CLI --header flags
  > API2MCP_BEARER_TOKEN
  > API2MCP_API_KEY
  > API2MCP_AUTH_TOKEN
  > config file auth
```

See [Authentication](/guide/auth) for full details.
