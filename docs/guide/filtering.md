# Filtering Tools

By default, every operation in your spec is exposed as an MCP tool. Use filters to narrow the set.

## Read-only mode

Expose only `GET` and `HEAD` operations — useful for giving an AI read access to an API without the ability to modify data:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml --readonly
```

## Whitelist with `--only`

Expose only specific operations by `operationId`:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --only "getIssue,listIssues,getProject"
```

## Blacklist with `--exclude`

Expose everything except specific operations:

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --exclude "deleteIssue,archiveProject,purgeWorkspace"
```

::: info
`--only` and `--exclude` are mutually exclusive. Pass operation names as a comma-separated list.
:::

## Combine with other flags

```bash
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  --readonly \
  --only "listMembers,getOrgDetails" \
  --bind "orgId=ORG_123"
```

## In config file

```yaml
options:
  readonly: true
  only:
    - getIssue
    - listIssues
  # exclude:  — mutually exclusive with only
```
