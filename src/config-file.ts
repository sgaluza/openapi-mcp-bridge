import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";

export interface ConfigFile {
  spec?: string;
  auth?: {
    token?: string;
    bearer?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    /** JWT password auth */
    type?: string;
    loginUrl?: string;
    usernameField?: string;
    passwordField?: string;
    tokenPath?: string;
    refreshUrl?: string;
  };
  options?: { readonly?: boolean; only?: string[]; exclude?: string[]; bind?: Record<string, string>; baseUrl?: string; };
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

const KNOWN_KEYS = new Set(["spec", "auth", "options"]);
const KNOWN_AUTH_KEYS = new Set(["token", "bearer", "apiKey", "headers", "type", "loginUrl", "usernameField", "passwordField", "tokenPath", "refreshUrl"]);
const KNOWN_OPTIONS_KEYS = new Set(["readonly", "only", "exclude", "bind", "baseUrl"]);

function parseConfigFile(path: string): ConfigFile {
  const content = readFileSync(path, "utf8");
  const parsed = parse(content) as ConfigFile;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file "${path}" must contain a YAML/JSON object.`);
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) process.stderr.write(`Warning: unknown config key '${key}' in ${path}\n`);
  }
  if (parsed.auth && typeof parsed.auth === "object") {
    for (const key of Object.keys(parsed.auth)) {
      if (!KNOWN_AUTH_KEYS.has(key)) process.stderr.write(`Warning: unknown auth key '${key}' in ${path}\n`);
    }
    if (parsed.auth.headers !== undefined) {
      if (typeof parsed.auth.headers !== "object" || Array.isArray(parsed.auth.headers)) {
        process.stderr.write(`Warning: auth.headers must be an object in ${path}\n`);
      } else {
        for (const [key, value] of Object.entries(parsed.auth.headers)) {
          if (typeof value !== "string") {
            process.stderr.write(`Warning: auth.headers.${key} must be a string, got ${typeof value} in ${path}\n`);
          }
        }
      }
    }
  }
  if (parsed.options && typeof parsed.options === "object") {
    for (const key of Object.keys(parsed.options)) {
      if (!KNOWN_OPTIONS_KEYS.has(key)) process.stderr.write(`Warning: unknown options key '${key}' in ${path}\n`);
    }
    if (parsed.options.readonly !== undefined && typeof parsed.options.readonly !== "boolean") {
      process.stderr.write(`Warning: options.readonly must be a boolean in ${path}\n`);
    }
    if (parsed.options.only !== undefined && !Array.isArray(parsed.options.only)) {
      process.stderr.write(`Warning: options.only must be an array in ${path}\n`);
    }
    if (parsed.options.exclude !== undefined && !Array.isArray(parsed.options.exclude)) {
      process.stderr.write(`Warning: options.exclude must be an array in ${path}\n`);
    }
    if (parsed.options.bind !== undefined && (typeof parsed.options.bind !== "object" || Array.isArray(parsed.options.bind))) {
      process.stderr.write(`Warning: options.bind must be an object in ${path}\n`);
    }
  }
  return parsed;
}
