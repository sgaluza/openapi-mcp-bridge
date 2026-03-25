# Config File

Store your spec URL, auth credentials, and options in a file instead of passing flags on every run.

## Auto-discovery

Drop a config file in your project directory — it will be picked up automatically:

- `api-to-mcp.yml`
- `api-to-mcp.yaml`
- `api-to-mcp.json`

## Explicit path

```bash
npx @sgaluza/api-to-mcp rest --config /path/to/my-config.yml
```

## Full example

```yaml
# api-to-mcp.yml
spec: https://api.example.com/openapi.yaml

auth:
  bearer: eyJhbGciOiJIUzI1...    # → Authorization: Bearer <token>
  # apiKey: pk_live_xxx           # → header from securitySchemes
  # token: lin_api_xxx            # → raw Authorization header
  headers:                        # arbitrary extra headers (lowest priority)
    X-Workspace-Id: ws_abc
    X-Version: "2"

options:
  readonly: true                  # only GET/HEAD operations
  only:
    - getIssue
    - listIssues
    - createIssue
  exclude:
    - deleteEverything
  bind:
    teamId: TEAM_ABC
    env: production
```

## Priority

CLI flags and environment variables always override the config file:

```
config file  <  env vars  <  CLI flags
(lowest)                    (highest)
```

For example, if `api-to-mcp.yml` has `auth.bearer: config-token` but `API2MCP_BEARER_TOKEN=env-token` is set in the environment, the env var wins.

## Use in MCP client config

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "rest",
        "--config", "/home/user/projects/myapp/api-to-mcp.yml"
      ]
    }
  }
}
```

::: warning
Avoid storing secrets in config files that are committed to version control. Use environment variables for credentials in CI/CD environments.
:::

## JSON format

JSON is also supported — the structure is identical:

```json
{
  "spec": "https://api.example.com/openapi.yaml",
  "auth": {
    "bearer": "eyJhbG..."
  },
  "options": {
    "readonly": true,
    "only": ["getIssue", "listIssues"]
  }
}
```
