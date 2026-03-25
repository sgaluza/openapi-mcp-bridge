import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";

export interface ConfigFile {
  spec?: string;
  auth?: { token?: string; bearer?: string; apiKey?: string; headers?: Record<string, string>; };
  options?: { readonly?: boolean; only?: string[]; exclude?: string[]; bind?: Record<string, string>; };
}

const CONFIG_CANDIDATES = ["api-to-mcp.yml", "api-to-mcp.yaml", "api-to-mcp.json"];

export function loadConfigFile(explicitPath?: string): ConfigFile | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) { throw new Error(`Config file not found: ${explicitPath}`); }
    return parseConfigFile(explicitPath);
  }
  for (const name of CONFIG_CANDIDATES) {
    if (existsSync(name)) { return parseConfigFile(name); }
  }
  return null;
}

export function mergeEnvWithConfig(env: Record<string, string | undefined>, auth?: ConfigFile["auth"]): Record<string, string | undefined> {
  return {
    ...(auth?.token ? { API2MCP_AUTH_TOKEN: auth.token } : {}),
    ...(auth?.bearer ? { API2MCP_BEARER_TOKEN: auth.bearer } : {}),
    ...(auth?.apiKey ? { API2MCP_API_KEY: auth.apiKey } : {}),
    ...env,
  };
}

function parseConfigFile(path: string): ConfigFile {
  const content = readFileSync(path, "utf8");
  const parsed = parse(content) as ConfigFile;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file "${path}" must contain a YAML/JSON object.`);
  }
  return parsed;
}
