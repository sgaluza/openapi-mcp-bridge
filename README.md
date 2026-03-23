# api-to-mcp

Turn any API into an MCP server via stdio bridge — connect OpenAPI-described REST APIs (and GraphQL, coming soon) directly to Claude, Cursor, or any MCP client.

```bash
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml
```

---

## Table of Contents

- [OpenAPI / REST](#openapi--rest)
  - [Quick start](#quick-start)
  - [Authentication](#authentication)
  - [Filtering tools](#filtering-tools)
  - [Pre-binding parameters](#pre-binding-parameters)
  - [Environment variables](#environment-variables)
  - [MCP client configuration](#mcp-client-configuration)
- [GraphQL](#graphql)
- [How it works](#how-it-works)
- [License](#license)

---

## OpenAPI / REST

### Quick start

```bash
# From a remote URL
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml

# From a local file
npx @sgaluza/api-to-mcp rest ./openapi.yaml

# Spec URL via environment variable (useful in MCP config files)
API2MCP_SPEC_URL=https://api.example.com/openapi.yaml npx @sgaluza/api-to-mcp rest
```

Every `operationId` in your spec becomes an MCP tool. If an operation has no `operationId`, a name is generated from the method and path (e.g. `GET /users/{id}` → `get_users_id`).

### Authentication

Pass credentials via `--header` flags or environment variables.

**Header flags** — added to every outgoing request:

```bash
# Single header
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "X-API-Key: pk_live_xxx"

# Multiple headers
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "X-API-Key: pk_live_xxx" \
  -H "X-Workspace-Id: ws_abc"
```

**Environment variables** — resolved automatically:

```bash
# Bearer token → Authorization: Bearer <token>
API2MCP_BEARER_TOKEN=eyJhbG... npx @sgaluza/api-to-mcp rest ./openapi.yaml

# API key — header name is detected from securitySchemes in the spec
API2MCP_API_KEY=pk_live_xxx npx @sgaluza/api-to-mcp rest ./openapi.yaml
```

Auth resolution order (highest wins):
1. `--header` / `-H` flags
2. `API2MCP_BEARER_TOKEN` → `Authorization: Bearer {token}`
3. `API2MCP_API_KEY` → header name from `securitySchemes` in spec

> Legacy aliases `OPENAPI_BEARER_TOKEN`, `OPENAPI_API_KEY`, `OPENAPI_SPEC_URL` are still supported.

### Filtering tools

By default all operations in the spec are exposed as MCP tools. Use filters to narrow the set.

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

> `--only` and `--exclude` are mutually exclusive. Pass operation names as a comma-separated list.

### Pre-binding parameters

Pre-bind a path or query parameter to a fixed value with `--bind key=value`. The parameter is hidden from the MCP tool's input schema — the bridge injects it automatically on every call.

Useful when you want Claude to operate within a specific workspace, team, or project without being able to change it.

```bash
# Always query within team TEAM_ABC
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "teamId=TEAM_ABC"

# Scope to a specific project and environment
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "projectId=PROJ_XYZ" \
  --bind "env=production"

# Combine with other filters
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --readonly \
  --bind "orgId=ORG_123" \
  --only "listMembers,getOrgDetails"
```

The bridge warns you if a bound key is not found in any tool (likely a typo):

```
Warning: --bind key 'temId' not found in any tool. Check for typos.
```

> **Note:** The `body` parameter (used for `POST`/`PUT`/`PATCH` request bodies) cannot be pre-bound — use `--header` for request-level overrides instead.

### Environment variables

| Variable | Description |
|---|---|
| `API2MCP_SPEC_URL` | OpenAPI spec URL or file path (alternative to positional argument) |
| `API2MCP_API_KEY` | API key — header name auto-detected from `securitySchemes` |
| `API2MCP_BEARER_TOKEN` | Bearer token — added as `Authorization: Bearer <token>` |

### MCP client configuration

**Claude Code / Claude Desktop / MetaMCP** — add to your `mcp_settings.json` or `claude_desktop_config.json`:

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

**Read-only API with bearer token:**

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

**Scoped to a specific team with selected operations:**

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "rest",
        "https://api.linear.app/graphql",
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

---

## GraphQL

GraphQL support is in development.

```bash
# Coming soon
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql
npx @sgaluza/api-to-mcp graphql ./schema.graphql
```

Planned flags match the REST subcommand: `--header`, `--readonly` (queries only, no mutations), `--only`, `--exclude`, `--bind`.

Track progress: [github.com/sgaluza/api-to-mcp/issues/1](https://github.com/sgaluza/api-to-mcp/issues/1)

---

## How it works

Each OpenAPI operation is converted to an MCP tool at startup:

| OpenAPI | MCP tool |
|---|---|
| `operationId` | Tool name (fallback: `{method}_{path}`) |
| `summary` + `description` | Tool description (description truncated to 200 chars) |
| Path params `{id}` | Required input parameters |
| Query params | Optional input parameters (required if `required: true` in spec) |
| `requestBody` (application/json) | `body` parameter (object matching the schema) |
| `servers[0].url` | Base URL for all requests |

When Claude calls a tool, the bridge:
1. Substitutes path parameters into the URL template
2. Appends query parameters
3. Serialises `body` as JSON (for POST/PUT/PATCH)
4. Injects pre-bound values and auth headers
5. Returns the response body as the tool result

---

## License

MIT
