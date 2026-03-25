import { defineConfig } from "vitepress";

export default defineConfig({
  title: "api-to-mcp",
  description: "Turn any API into an MCP server in one command",
  base: "/api-to-mcp/",

  head: [
    ["link", { rel: "icon", href: "/api-to-mcp/favicon.svg", type: "image/svg+xml" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "api-to-mcp",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "npm", link: "https://www.npmjs.com/package/@sgaluza/api-to-mcp" },
      {
        text: "v0.2.5",
        items: [
          { text: "Changelog", link: "https://github.com/sgaluza/api-to-mcp/releases" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
        ],
      },
      {
        text: "REST / OpenAPI",
        items: [
          { text: "Quick Start", link: "/guide/rest" },
          { text: "Authentication", link: "/guide/auth" },
          { text: "Config File", link: "/guide/config-file" },
          { text: "Filtering Tools", link: "/guide/filtering" },
          { text: "Parameter Binding", link: "/guide/binding" },
        ],
      },
      {
        text: "GraphQL",
        items: [
          { text: "Quick Start", link: "/guide/graphql" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Environment Variables", link: "/guide/env-vars" },
          { text: "MCP Client Config", link: "/guide/mcp-config" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/sgaluza/api-to-mcp" },
      { icon: "npm", link: "https://www.npmjs.com/package/@sgaluza/api-to-mcp" },
    ],

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Built with ❤️ for the MCP ecosystem",
    },
  },
});
