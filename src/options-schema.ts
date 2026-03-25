import type { Command } from "commander";
import type { ConfigFile } from "./config-file.js";

export type OptionType = "string" | "boolean" | "array";

export interface OptionDef {
  /** Internal key matching commander opts property name */
  key: string;
  /** Commander option string e.g. "--readonly" or "--only <operations>" */
  cli?: string;
  /** Env var name(s) — first match wins */
  env: string | string[];
  /** Dot-path into ConfigFile e.g. "options.readonly", "auth.bearer" */
  config: string;
  /** Description shown in --help */
  description: string;
  /** Value type: string | boolean | array (array = comma-separated string from CLI/env, string[] from config) */
  type: OptionType;
  /** Fallback when no source provides a value */
  default?: unknown;
}

/** Named options shared by both `rest` and `graphql` commands */
export const SHARED_OPTIONS: OptionDef[] = [
  {
    key: "readonly",
    cli: "--readonly",
    env: "API2MCP_READONLY",
    config: "options.readonly",
    description: "Expose only read operations (no mutations)",
    type: "boolean",
    default: false,
  },
  {
    key: "only",
    cli: "--only <operations>",
    env: "API2MCP_ONLY",
    config: "options.only",
    description: "Whitelist operations by name, comma-separated",
    type: "array",
  },
  {
    key: "exclude",
    cli: "--exclude <operations>",
    env: "API2MCP_EXCLUDE",
    config: "options.exclude",
    description: "Blacklist operations by name, comma-separated",
    type: "array",
  },
  {
    key: "config",
    cli: "--config <path>",
    env: [],
    config: "",
    description: "Path to config file (default: auto-discover api-to-mcp.yml/yaml/json)",
    type: "string",
  },
];

/** Spec/endpoint source: positional arg + env + config (no CLI flag) */
export const SPEC_OPTION: OptionDef = {
  key: "spec",
  env: ["API2MCP_SPEC_URL", "OPENAPI_SPEC_URL"],
  config: "spec",
  description: "OpenAPI spec URL or file path",
  type: "string",
};

/** Get a nested value from an object by dot-path ("options.readonly" etc.) */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc !== null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    /* v8 ignore next */
    return undefined;
  }, obj);
}

/** Coerce a string env var value to the target option type */
function coerceEnv(value: string, type: OptionType): unknown {
  if (type === "boolean") return value === "true" || value === "1";
  return value; // string and array both return raw string (array = comma-separated)
}

/**
 * Resolve an option value using priority: CLI > env vars > config file > default.
 *
 * For "array" type, config string[] is joined with "," to match CLI/env format.
 */
export function resolveOption(
  def: OptionDef,
  cliValue: unknown,
  env: Record<string, string | undefined>,
  config: ConfigFile | null
): unknown {
  // 1. CLI (highest priority)
  if (cliValue !== undefined) return cliValue;

  // 2. Env vars
  const envNames = Array.isArray(def.env) ? def.env : def.env ? [def.env] : [];
  for (const name of envNames) {
    const val = env[name];
    if (val !== undefined) return coerceEnv(val, def.type);
  }

  // 3. Config file
  if (config && def.config) {
    const val = getPath(config, def.config);
    if (val !== undefined) {
      if (def.type === "array" && Array.isArray(val)) return val.join(",");
      return val;
    }
  }

  // 4. Default
  return def.default;
}

/**
 * Register named CLI options from a schema onto a commander Command.
 * Skips options without a `cli` field (positional / env-only options).
 */
export function registerOptions(cmd: Command, defs: OptionDef[]): void {
  for (const def of defs) {
    if (def.cli) cmd.option(def.cli, def.description);
  }
}
