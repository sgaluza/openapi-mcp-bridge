# Authentication

Pass credentials via `--header` flags, environment variables, or a [config file](/guide/config-file).

## Priority order

When multiple auth sources are set, the highest-priority source wins:

| Priority | Source | Result |
|----------|--------|--------|
| 1 — highest | `--header` / `-H` flags | Used as-is |
| 2 | `API2MCP_BEARER_TOKEN` env | `Authorization: Bearer <token>` |
| 3 | `API2MCP_API_KEY` env | Header from `securitySchemes` in spec |
| 4 | `API2MCP_AUTH_TOKEN` env | Raw `Authorization: <value>` |
| 5 — lowest | `auth` in config file | Overridden by any env var above |

## Header flags

Added to every outgoing request:

```bash
# Single header
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "X-API-Key: pk_live_xxx"

# Multiple headers
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "X-API-Key: pk_live_xxx" \
  -H "X-Workspace-Id: ws_abc"
```

## Environment variables

### Bearer token

```bash
API2MCP_BEARER_TOKEN=eyJhbG... npx @sgaluza/api-to-mcp rest ./openapi.yaml
# → Authorization: Bearer eyJhbG...
```

### API key

The header name is auto-detected from `securitySchemes` in your OpenAPI spec:

```bash
API2MCP_API_KEY=pk_live_xxx npx @sgaluza/api-to-mcp rest ./openapi.yaml
# → X-API-Key: pk_live_xxx  (header name from spec)
```

### Raw Authorization header

For APIs that use a token directly in the `Authorization` header without `Bearer`:

```bash
API2MCP_AUTH_TOKEN=lin_api_xxx npx @sgaluza/api-to-mcp rest ./openapi.yaml
# → Authorization: lin_api_xxx
```

::: tip Linear API keys
Linear uses `Authorization: lin_api_xxx` (not `Bearer`). Use `API2MCP_AUTH_TOKEN` for this.
:::

## Config file

Store credentials in `api-to-mcp.yml`:

```yaml
auth:
  bearer: eyJhbG...        # → Authorization: Bearer <token>
  # apiKey: pk_live_xxx    # → header from securitySchemes
  # token: lin_api_xxx     # → raw Authorization header
  headers:                 # arbitrary headers (lowest priority)
    X-Workspace-Id: ws_abc
```

See [Config File](/guide/config-file) for details.

## Legacy env vars

The following aliases are still supported for backward compatibility:

| Legacy | Current |
|--------|---------|
| `OPENAPI_BEARER_TOKEN` | `API2MCP_BEARER_TOKEN` |
| `OPENAPI_API_KEY` | `API2MCP_API_KEY` |
| `OPENAPI_SPEC_URL` | `API2MCP_SPEC_URL` |
