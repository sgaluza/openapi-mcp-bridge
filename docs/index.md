---
layout: home

hero:
  name: "api-to-mcp"
  text: "Any API → MCP server"
  tagline: Connect OpenAPI and GraphQL APIs to Claude, Cursor, or any MCP client — one command, no code.
  image:
    src: /hero.svg
    alt: api-to-mcp
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/sgaluza/api-to-mcp

features:
  - icon: ⚡️
    title: One command
    details: Point it at any OpenAPI spec or GraphQL endpoint and get a fully-functional MCP server instantly via stdio.
  - icon: 🔐
    title: Flexible auth
    details: Bearer tokens, API keys, raw headers — or store credentials in a config file. Priority rules are explicit and predictable.
  - icon: 🎯
    title: Scoped access
    details: Whitelist operations with --only, blacklist with --exclude, or use --readonly. Pre-bind parameters to lock down scope.
  - icon: 📄
    title: Config file
    details: Store spec URL, auth, and options in api-to-mcp.yml — auto-discovered in your project directory.
  - icon: 🔗
    title: GraphQL support
    details: Auto-introspect GraphQL schemas or load from SDL files. Queries and mutations become MCP tools automatically.
  - icon: 🛠️
    title: Works everywhere
    details: Claude Code, Claude Desktop, Cursor, MetaMCP — any MCP client that supports stdio transport.
---
