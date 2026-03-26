# api-to-mcp

[![npm version](https://img.shields.io/npm/v/@sgaluza/api-to-mcp)](https://www.npmjs.com/package/@sgaluza/api-to-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@sgaluza/api-to-mcp)](https://www.npmjs.com/package/@sgaluza/api-to-mcp)
[![CI](https://github.com/sgaluza/api-to-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sgaluza/api-to-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Turn any API into an MCP server in one command.**

Connect OpenAPI REST and GraphQL APIs directly to Claude, Cursor, or any [MCP](https://modelcontextprotocol.io) client — no code required.

```bash
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml
```

```
OpenAPI spec / GraphQL schema
        │
        ▼
  api-to-mcp (stdio)
        │
        ├── tool: getUser
        ├── tool: listIssues
        ├── tool: createIssue
        └── tool: ...
        │
        ▼
  Claude / Cursor / any MCP client
```

---

## Table of Contents

- [Quick start](#quick-start)
- [OpenAPI / REST](#openapi--rest)
  - [Authentication](#authentication)
  - [JWT password authentication](#jwt-password-authentication)
  - [Base URL override](#base-url-override)
  - [Config file](#config-file)
  - [Filtering tools](#filtering-tools)
  - [Pre-binding parameters](#pre-binding-parameters)
  - [Environment variables](#environment-variables)
  - [MCP client configuration](#mcp-client-configuration)
- [GraphQL](#graphql)
- [How it works](#how-it-works)
- [License](#license)

---

## Quick start

```bash
# REST — from a remote OpenAPI spec
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml

# REST — from a local file
npx @sgaluza/api-to-mcp rest ./openapi.yaml

# GraphQL — from an endpoint (auto-introspects schema)
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql

# GraphQL — from a local SDL file
npx @sgaluza/api-to-mcp graphql ./schema.graphql
```

Every `operationId` (REST) or operation name (GraphQL) becomes an MCP tool. If an operation has no `operationId`, a name is generated from the method and path (e.g. `GET /users/{id}` → `get_users_id`).

---

## OpenAPI / REST

### Authentication

Pass credentials via `--header` flags, environment variables, or a [config file](#config-file).

**Header flags** — added to every outgoing request:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "X-API-Key: pk_live_xxx" \
  -H "X-Workspace-Id: ws_abc"
```

**Environment variables:**

```bash
# Bearer token → Authorization: Bearer <token>
API2MCP_BEARER_TOKEN=eyJhbG... npx @sgaluza/api-to-mcp rest ./openapi.yaml

# API key — header name detected from securitySchemes in the spec
API2MCP_API_KEY=pk_live_xxx npx @sgaluza/api-to-mcp rest ./openapi.yaml

# Raw Authorization header value (e.g. Linear API keys use "lin_api_xxx" without Bearer)
API2MCP_AUTH_TOKEN=lin_api_xxx npx @sgaluza/api-to-mcp rest ./openapi.yaml
```

**Auth resolution order** (highest priority wins):

| Priority | Source | Result |
|----------|--------|--------|
| 1 (highest) | `--header` / `-H` flags | Used as-is |
| 2 | `API2MCP_BEARER_TOKEN` env | `Authorization: Bearer <token>` |
| 3 | `API2MCP_API_KEY` env | Header name from `securitySchemes` in spec |
| 4 | `API2MCP_AUTH_TOKEN` env | Raw `Authorization: <token>` |
| 5 (lowest) | `auth` in config file | Overridden by any env var above |

> Legacy aliases `OPENAPI_BEARER_TOKEN`, `OPENAPI_API_KEY`, `OPENAPI_SPEC_URL` are still supported.

---

### JWT password authentication

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
  --auth-password-field password \
  --auth-token-path jwt \
  --auth-refresh-url https://api.example.com/auth/refresh-token
```

| Flag | Env variable | Default | Description |
|------|-------------|---------|-------------|
| `--auth-type jwt-password` | `API2MCP_AUTH_TYPE` | — | Enable JWT password auth |
| `--auth-login-url <url>` | `API2MCP_AUTH_LOGIN_URL` | — | Login endpoint (POST) |
| `--auth-username-field <field>` | `API2MCP_AUTH_USERNAME_FIELD` | `username` | Request body field for username |
| `--auth-password-field <field>` | `API2MCP_AUTH_PASSWORD_FIELD` | `password` | Request body field for password |
| `--auth-token-path <path>` | `API2MCP_AUTH_TOKEN_PATH` | `token` | Path to JWT in login response: simple (`jwt`), dot-path (`data.token`), or JSONPath (`$.response.jwt`) |
| `--auth-refresh-url <url>` | `API2MCP_AUTH_REFRESH_URL` | — | Optional token refresh endpoint (GET) |

Credentials are passed via environment variables (never as CLI flags):

```bash
API2MCP_USERNAME=alice API2MCP_PASSWORD=s3cret \
  npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml \
  --auth-type jwt-password \
  --auth-login-url https://api.example.com/auth/login
```

**Config file:**

```yaml
auth:
  type: jwt-password
  loginUrl: https://api.example.com/auth/login
  usernameField: userName       # default: username
  passwordField: password       # default: password
  tokenPath: jwt                # default: token
  refreshUrl: https://api.example.com/auth/refresh-token
```

**MCP client config** (credentials injected via `env`):

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

---

### Base URL override

Override the base URL extracted from `servers[0].url` in the spec. Useful when the spec is hosted on a different domain than the API (e.g. staging spec + production API):

```bash
npx @sgaluza/api-to-mcp rest https://staging.example.com/openapi.json \
  --base-url https://api.example.com
```

| Flag | Env variable | Config key | Description |
|------|-------------|------------|-------------|
| `--base-url <url>` | `API2MCP_BASE_URL` | `options.baseUrl` | Override base URL from spec's `servers[0].url` |

---

### Config file

Store your spec URL, auth, and options in a file instead of passing flags every time.

**Auto-discovery:** `api-to-mcp.yml`, `api-to-mcp.yaml`, or `api-to-mcp.json` in the current directory.

**Explicit path:** `--config path/to/config.yml`

```yaml
# api-to-mcp.yml
spec: https://api.example.com/openapi.yaml

auth:
  bearer: eyJhbG...          # → Authorization: Bearer <token>
  # apiKey: pk_live_xxx      # → header from securitySchemes
  # token: lin_api_xxx       # → raw Authorization header
  headers:                   # arbitrary headers (lowest priority)
    X-Workspace-Id: ws_abc

options:
  readonly: true             # only GET/HEAD operations
  baseUrl: https://api.example.com  # override spec's servers[0].url
  only:
    - getIssue
    - listIssues
  exclude:
    - deleteEverything
  bind:
    teamId: TEAM_ABC
```

**Priority:** CLI flags > environment variables > config file.

---

### Filtering tools

**Read-only mode** — expose only `GET` and `HEAD` operations:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml --readonly
```

**Whitelist** — expose only specific operations by `operationId`:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --only "getIssue,listIssues,getProject"
```

**Blacklist** — expose everything except specific operations:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --exclude "deleteIssue,archiveProject,purgeWorkspace"
```

> `--only` and `--exclude` are mutually exclusive.

---

### Overriding tool descriptions

Sometimes an OpenAPI spec has poor or missing descriptions on generated tools (e.g. undocumented enum values, ambiguous parameter names). You can override any tool's description without modifying the spec.

**Config file:**

```yaml
# api-to-mcp.yml
overrides:
  post_api_quote_items: "Get paginated quotes. IMPORTANT: sorter.property must be PascalCase (Created, Number, Client, Status), sorter.direction must be Asc or Desc."
  getUser: "Fetch a single user by ID."
```

**Environment variable** (takes priority over config file):

```bash
API2MCP_OVERRIDE_post_api_quote_items="Get paginated quotes. IMPORTANT: sorter.property must be PascalCase..."
```

Only the `description` field is replaced — the tool name, input schema, and all other properties remain unchanged.

---

### Pre-binding parameters

Pre-bind a path or query parameter to a fixed value with `--bind key=value`. The parameter is removed from the MCP tool's input schema — the bridge injects it automatically on every call.

Useful when you want Claude to operate within a specific workspace, team, or project without being able to change it.

```bash
# Always query within team TEAM_ABC
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "teamId=TEAM_ABC"

# Scope to a specific project
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "projectId=PROJ_XYZ" \
  --bind "env=production"
```

The bridge warns if a bound key is not found in any tool (likely a typo):

```
Warning: --bind key 'temId' not found in any tool. Check for typos.
```

> **Note:** The `body` parameter (POST/PUT/PATCH request bodies) cannot be pre-bound.

---

### Environment variables

| Variable | Description |
|----------|-------------|
| `API2MCP_SPEC_URL` | OpenAPI spec URL or file path (alternative to positional argument) |
| `API2MCP_BASE_URL` | Override base URL from spec's `servers[0].url` |
| `API2MCP_BEARER_TOKEN` | Bearer token → `Authorization: Bearer <token>` |
| `API2MCP_API_KEY` | API key → header name from `securitySchemes` |
| `API2MCP_AUTH_TOKEN` | Raw `Authorization` header value |
| `API2MCP_AUTH_TYPE` | Auth type — currently supports `jwt-password` |
| `API2MCP_AUTH_LOGIN_URL` | JWT login endpoint URL |
| `API2MCP_USERNAME` | Username for JWT password auth |
| `API2MCP_PASSWORD` | Password for JWT password auth |
| `API2MCP_AUTH_USERNAME_FIELD` | Request body field for username (default: `username`) |
| `API2MCP_AUTH_PASSWORD_FIELD` | Request body field for password (default: `password`) |
| `API2MCP_AUTH_TOKEN_PATH` | Path to JWT in login response (default: `token`) |
| `API2MCP_AUTH_REFRESH_URL` | JWT refresh endpoint URL |
| `API2MCP_OVERRIDE_<toolName>` | Override description for a specific tool (e.g. `API2MCP_OVERRIDE_getFoo="Custom description"`) |

---

### MCP client configuration

Add to your `mcp_settings.json`, `claude_desktop_config.json`, or equivalent:

**Minimal:**

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "rest", "https://api.example.com/openapi.yaml"],
      "env": {
        "API2MCP_API_KEY": "pk_live_xxx"
      }
    }
  }
}
```

**GitHub — read-only with bearer token:**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "rest",
        "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
        "--readonly"
      ],
      "env": {
        "API2MCP_BEARER_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

**Linear — scoped to a team, specific operations:**

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "rest",
        "https://api.linear.app/rest/openapi.yaml",
        "--bind", "teamId=TEAM_ABC",
        "--only", "listIssues,getIssue,createIssue,updateIssue"
      ],
      "env": {
        "API2MCP_BEARER_TOKEN": "lin_api_xxx"
      }
    }
  }
}
```

**Using a config file:**

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "rest", "--config", "/path/to/api-to-mcp.yml"]
    }
  }
}
```

---

## GraphQL

```bash
# Auto-introspect schema from a GraphQL endpoint
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql

# Load schema from a local SDL file
npx @sgaluza/api-to-mcp graphql ./schema.graphql
```

All queries and mutations become MCP tools. The same flags apply: `--header`, `--readonly` (queries only, no mutations), `--only`, `--exclude`, `--bind`, `--config`.

**MCP client config:**

```json
{
  "mcpServers": {
    "my-graphql-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "graphql", "https://api.example.com/graphql"],
      "env": {
        "API2MCP_BEARER_TOKEN": "eyJhbG..."
      }
    }
  }
}
```

---

## How it works

Each API operation is converted to an MCP tool at startup:

**REST (OpenAPI):**

| OpenAPI | MCP tool |
|---------|----------|
| `operationId` | Tool name (fallback: `{method}_{path}`) |
| `summary` + `description` | Tool description |
| Path params `{id}` | Required input parameters |
| Query params | Optional input parameters |
| `requestBody` (application/json) | `body` parameter |
| `servers[0].url` | Base URL for all requests |

**GraphQL:**

| GraphQL | MCP tool |
|---------|----------|
| Query / Mutation name | Tool name |
| Description from schema | Tool description |
| Arguments | Input parameters |
| Return type fields | Included in description |

When Claude calls a tool, the bridge:

1. Substitutes path parameters into the URL template
2. Appends query parameters
3. Serialises `body` as JSON (for POST/PUT/PATCH)
4. Injects pre-bound values and auth headers
5. Returns the response body as the tool result

---

## License

MIT
