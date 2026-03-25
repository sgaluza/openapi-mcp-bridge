# Environment Variables

## Reference

| Variable | Description |
|----------|-------------|
| `API2MCP_SPEC_URL` | OpenAPI spec URL or file path (alternative to positional argument) |
| `API2MCP_BEARER_TOKEN` | Bearer token → `Authorization: Bearer <token>` |
| `API2MCP_API_KEY` | API key → header name from `securitySchemes` in spec |
| `API2MCP_AUTH_TOKEN` | Raw `Authorization` header value |

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
