# MCP Client Configuration

Add `api-to-mcp` to any MCP client by configuring it as a stdio server.

## Claude Code

Edit `~/.claude/mcp_settings.json` (or project-level `.mcp.json`):

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

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "rest", "https://api.example.com/openapi.yaml"],
      "env": {
        "API2MCP_BEARER_TOKEN": "eyJhbG..."
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json` in your project:

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

## MetaMCP

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

---

## Real-world examples

### GitHub — read-only

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

### Linear — scoped to a team

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

### Using a config file

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

### GraphQL API

```json
{
  "mcpServers": {
    "my-graphql": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "graphql",
        "https://api.example.com/graphql"
      ],
      "env": {
        "API2MCP_BEARER_TOKEN": "eyJhbG..."
      }
    }
  }
}
```
