# Parameter Binding

Pre-bind a path or query parameter to a fixed value. The parameter is removed from the MCP tool's input schema — the bridge injects it automatically on every call.

This is useful when you want an AI to operate within a specific workspace, team, or project without being able to change it.

## Usage

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "teamId=TEAM_ABC"
```

## Multiple bindings

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --bind "projectId=PROJ_XYZ" \
  --bind "env=production"
```

## Combined example

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --readonly \
  --bind "orgId=ORG_123" \
  --only "listMembers,getOrgDetails"
```

## Typo detection

The bridge warns you if a bound key is not found in any tool:

```
Warning: --bind key 'temId' not found in any tool. Check for typos.
```

## In config file

```yaml
options:
  bind:
    teamId: TEAM_ABC
    projectId: PROJ_XYZ
```

## Limitations

- The `body` parameter (used for POST/PUT/PATCH request bodies) cannot be pre-bound.
- Bindings apply globally to all tools — you can't bind a parameter for only one specific tool.
