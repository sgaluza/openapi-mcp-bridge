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
| 5 | JWT password auth | `Authorization: Bearer <jwt>` (auto-managed) |
| 6 — lowest | `auth` in config file | Overridden by any env var above |

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

## JWT password authentication

Some APIs authenticate with a username/password login endpoint that returns a short-lived JWT. `api-to-mcp` handles the full token lifecycle automatically:

- **Lazy login** — token is fetched on the first request, not at startup
- **Auto-refresh** — token is proactively refreshed 5 minutes before expiry
- **401 retry** — if the server returns 401, the token is force-refreshed and the request is retried once
- **Deduplication** — concurrent requests share a single in-flight login call

```bash
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml \
  --auth-type jwt-password \
  --auth-login-url https://api.example.com/auth/login \
  --auth-username-field userName \
  --auth-token-path jwt \
  --auth-refresh-url https://api.example.com/auth/refresh-token
```

Credentials are always passed via environment variables:

```bash
API2MCP_USERNAME=alice API2MCP_PASSWORD=s3cret \
  npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml \
  --auth-type jwt-password \
  --auth-login-url https://api.example.com/auth/login
```

### Options

| Flag | Env variable | Default | Description |
|------|-------------|---------|-------------|
| `--auth-type jwt-password` | `API2MCP_AUTH_TYPE` | — | Enable JWT password auth |
| `--auth-login-url <url>` | `API2MCP_AUTH_LOGIN_URL` | — | Login endpoint (POST) |
| `--auth-username-field <field>` | `API2MCP_AUTH_USERNAME_FIELD` | `username` | Request body field for username |
| `--auth-password-field <field>` | `API2MCP_AUTH_PASSWORD_FIELD` | `password` | Request body field for password |
| `--auth-token-path <path>` | `API2MCP_AUTH_TOKEN_PATH` | `token` | Path to JWT in login response |
| `--auth-refresh-url <url>` | `API2MCP_AUTH_REFRESH_URL` | — | Optional token refresh endpoint (GET) |

The `--auth-token-path` supports three formats:
- Simple field name: `token`, `jwt`
- Dot-path: `data.accessToken`, `response.jwt`
- JSONPath: `$.data.token`, `$.jwt`

### Config file

```yaml
auth:
  type: jwt-password
  loginUrl: https://api.example.com/auth/login
  usernameField: userName       # default: username
  passwordField: password       # default: password
  tokenPath: jwt                # default: token
  refreshUrl: https://api.example.com/auth/refresh-token
```

### MCP client config

Use `env` to pass credentials — never hardcode them in `args`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "rest",
        "https://api.example.com/openapi.yaml",
        "--auth-type", "jwt-password",
        "--auth-login-url", "https://api.example.com/auth/login",
        "--auth-username-field", "userName",
        "--auth-token-path", "jwt"
      ],
      "env": {
        "API2MCP_USERNAME": "alice",
        "API2MCP_PASSWORD": "s3cret"
      }
    }
  }
}
```

::: tip No config file needed
All JWT options can be passed as CLI flags or env vars — no config file required. This makes it easy to use in environments like Claude Desktop or MetaMCP where dropping a config file isn't practical.
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
