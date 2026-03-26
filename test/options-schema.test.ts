import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  resolveOption,
  registerOptions,
  findSharedOption,
  SHARED_OPTIONS,
  SPEC_OPTION,
  type OptionDef,
} from "../src/options-schema.js";
import type { ConfigFile } from "../src/config-file.js";

/** Helper to find a shared option by key */
const findDef = (key: string): OptionDef =>
  SHARED_OPTIONS.find((d) => d.key === key)!;

describe("resolveOption — priority: CLI > env > config > default", () => {
  it("returns CLI value when provided (highest priority)", () => {
    const def = findDef("readonly");
    const result = resolveOption(
      def,
      true,
      { API2MCP_READONLY: "false" },
      { options: { readonly: false } }
    );
    expect(result).toBe(true);
  });

  it("returns env var value when CLI is undefined", () => {
    const def = findDef("only");
    const result = resolveOption(
      def,
      undefined,
      { API2MCP_ONLY: "getUser,listUsers" },
      null
    );
    expect(result).toBe("getUser,listUsers");
  });

  it("returns config file string value when CLI and env are absent", () => {
    const def = findDef("only");
    const config: ConfigFile = { options: { only: ["getUser", "listUsers"] } };
    const result = resolveOption(def, undefined, {}, config);
    // array from config is joined with comma
    expect(result).toBe("getUser,listUsers");
  });

  it("joins config array with comma for array-type options", () => {
    const def = findDef("exclude");
    const config: ConfigFile = { options: { exclude: ["deleteUser", "archiveProject"] } };
    const result = resolveOption(def, undefined, {}, config);
    expect(result).toBe("deleteUser,archiveProject");
  });

  it("returns config scalar string when type is string", () => {
    const config: ConfigFile = { spec: "https://api.example.com/openapi.yaml" };
    const result = resolveOption(SPEC_OPTION, undefined, {}, config);
    expect(result).toBe("https://api.example.com/openapi.yaml");
  });

  it("returns default when no CLI, env, or config value is present", () => {
    const def = findDef("readonly");
    const result = resolveOption(def, undefined, {}, null);
    expect(result).toBe(false);
  });

  it("returns undefined default when no default is defined and no sources match", () => {
    const def = findDef("only");
    const result = resolveOption(def, undefined, {}, null);
    expect(result).toBeUndefined();
  });

  it("CLI overrides env and config simultaneously", () => {
    const def = findDef("only");
    const config: ConfigFile = { options: { only: ["fromConfig"] } };
    const result = resolveOption(
      def,
      "fromCli",
      { API2MCP_ONLY: "fromEnv" },
      config
    );
    expect(result).toBe("fromCli");
  });

  it("env overrides config but not CLI", () => {
    const def = findDef("exclude");
    const config: ConfigFile = { options: { exclude: ["fromConfig"] } };
    const result = resolveOption(
      def,
      undefined,
      { API2MCP_EXCLUDE: "fromEnv" },
      config
    );
    expect(result).toBe("fromEnv");
  });
});

describe("resolveOption — boolean coercion from env var", () => {
  it('coerces env "true" to boolean true', () => {
    const def = findDef("readonly");
    const result = resolveOption(def, undefined, { API2MCP_READONLY: "true" }, null);
    expect(result).toBe(true);
  });

  it('coerces env "1" to boolean true', () => {
    const def = findDef("readonly");
    const result = resolveOption(def, undefined, { API2MCP_READONLY: "1" }, null);
    expect(result).toBe(true);
  });

  it('coerces env "false" to boolean false', () => {
    const def = findDef("readonly");
    const result = resolveOption(def, undefined, { API2MCP_READONLY: "false" }, null);
    expect(result).toBe(false);
  });

  it('coerces env "0" to boolean false', () => {
    const def = findDef("readonly");
    const result = resolveOption(def, undefined, { API2MCP_READONLY: "0" }, null);
    expect(result).toBe(false);
  });

  it("does not coerce string-type env var values", () => {
    const result = resolveOption(SPEC_OPTION, undefined, { API2MCP_SPEC_URL: "https://example.com" }, null);
    expect(result).toBe("https://example.com");
  });
});

describe("resolveOption — multiple env var names (first found wins)", () => {
  it("uses first env var name when both are defined", () => {
    const result = resolveOption(
      SPEC_OPTION,
      undefined,
      { API2MCP_SPEC_URL: "first", OPENAPI_SPEC_URL: "second" },
      null
    );
    expect(result).toBe("first");
  });

  it("falls back to second env var when first is absent", () => {
    const result = resolveOption(
      SPEC_OPTION,
      undefined,
      { OPENAPI_SPEC_URL: "legacy" },
      null
    );
    expect(result).toBe("legacy");
  });

  it("falls back to config when neither env var is set", () => {
    const config: ConfigFile = { spec: "from-config" };
    const result = resolveOption(SPEC_OPTION, undefined, {}, config);
    expect(result).toBe("from-config");
  });
});

describe("resolveOption — empty env array (config-only option)", () => {
  it("skips env lookup when env is empty array and falls through to config", () => {
    // The "config" option def has env: []
    const configDef = findDef("config");
    const result = resolveOption(
      configDef,
      undefined,
      { ANY_VAR: "something" },
      null
    );
    // no default, no config path — should be undefined
    expect(result).toBeUndefined();
  });

  it("returns CLI value for config option when provided", () => {
    const configDef = findDef("config");
    const result = resolveOption(configDef, "/path/to/config.yml", {}, null);
    expect(result).toBe("/path/to/config.yml");
  });
});

describe("registerOptions", () => {
  it("registers all shared options that have a cli field", () => {
    const cmd = new Command();
    registerOptions(cmd, SHARED_OPTIONS);

    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--readonly");
    expect(optionNames).toContain("--only");
    expect(optionNames).toContain("--exclude");
    expect(optionNames).toContain("--config");
  });

  it("does not register SPEC_OPTION because it has no cli field", () => {
    const cmd = new Command();
    registerOptions(cmd, [SPEC_OPTION]);
    expect(cmd.options).toHaveLength(0);
  });

  it("skips options without a cli field mixed in a list", () => {
    const mixedDefs: OptionDef[] = [
      findDef("readonly"),
      SPEC_OPTION, // no cli
      findDef("only"),
    ];
    const cmd = new Command();
    registerOptions(cmd, mixedDefs);

    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--readonly");
    expect(optionNames).toContain("--only");
    expect(optionNames).not.toContain("--spec");
    expect(cmd.options).toHaveLength(2);
  });

  it("registers options with correct descriptions", () => {
    const cmd = new Command();
    registerOptions(cmd, SHARED_OPTIONS);

    const readonlyOpt = cmd.options.find((o) => o.long === "--readonly");
    expect(readonlyOpt?.description).toBe("Expose only read operations (no mutations)");

    const configOpt = cmd.options.find((o) => o.long === "--config");
    expect(configOpt?.description).toBe(
      "Path to config file (default: auto-discover api-to-mcp.yml/yaml/json)"
    );
  });

  it("does nothing when given an empty array", () => {
    const cmd = new Command();
    registerOptions(cmd, []);
    expect(cmd.options).toHaveLength(0);
  });
});

describe("SPEC_OPTION structure", () => {
  it("has no cli field", () => {
    expect(SPEC_OPTION.cli).toBeUndefined();
  });

  it("has multiple env var names", () => {
    expect(Array.isArray(SPEC_OPTION.env)).toBe(true);
    expect(SPEC_OPTION.env).toContain("API2MCP_SPEC_URL");
    expect(SPEC_OPTION.env).toContain("OPENAPI_SPEC_URL");
  });

  it("maps to 'spec' config path", () => {
    expect(SPEC_OPTION.config).toBe("spec");
  });
});

describe("findSharedOption", () => {
  it("returns option def when key exists", () => {
    const def = findSharedOption("readonly");
    expect(def.key).toBe("readonly");
    expect(def.type).toBe("boolean");
  });

  it("throws error when key does not exist", () => {
    expect(() => findSharedOption("nonexistent")).toThrow(
      "Internal: shared option 'nonexistent' not found in SHARED_OPTIONS",
    );
  });
});

describe("resolveOption — edge cases", () => {
  it("returns undefined when env is empty string (falsy non-array, no env lookup)", () => {
    const def: OptionDef = {
      key: "test",
      env: "",
      config: "spec",
      description: "",
      type: "string",
    };
    const result = resolveOption(def, undefined, { "": "ignored" }, null);
    expect(result).toBeUndefined();
  });

  it("returns undefined when config path traverses through non-object intermediate", () => {
    const def: OptionDef = {
      key: "test",
      env: "TEST_ENV",
      config: "options.readonly",
      description: "",
      type: "boolean",
    };
    // options is a string, not an object — path traversal hits non-object intermediate
    const config = { options: "not-an-object" } as unknown as ConfigFile;
    const result = resolveOption(def, undefined, {}, config);
    expect(result).toBeUndefined();
  });
});

