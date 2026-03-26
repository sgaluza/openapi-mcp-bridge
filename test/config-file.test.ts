import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfigFile, mergeEnvWithConfig } from "../src/config-file.js";

/**
 * Test suite for loadConfigFile and mergeEnvWithConfig.
 * Uses a real temp directory to avoid mocking complexity.
 */
describe("loadConfigFile", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "api-to-mcp-test-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when explicit path does not exist", () => {
    expect(() => loadConfigFile("/nonexistent/path/api-to-mcp.yml")).toThrow(
      "Config file not found: /nonexistent/path/api-to-mcp.yml"
    );
  });

  it("parses a valid YAML file at explicit path", () => {
    const filePath = join(tmpDir, "my-config.yml");
    writeFileSync(
      filePath,
      `spec: https://api.example.com/openapi.yaml
auth:
  bearer: mytoken
options:
  readonly: true
  only:
    - getUsers
    - listProjects
  bind:
    teamId: TEAM_ABC
`
    );
    const config = loadConfigFile(filePath);
    expect(config).toEqual({
      spec: "https://api.example.com/openapi.yaml",
      auth: { bearer: "mytoken" },
      options: {
        readonly: true,
        only: ["getUsers", "listProjects"],
        bind: { teamId: "TEAM_ABC" },
      },
    });
  });

  it("parses a valid JSON file at explicit path", () => {
    const filePath = join(tmpDir, "my-config.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        spec: "https://api.example.com/openapi.yaml",
        auth: { apiKey: "key123" },
        options: { exclude: ["deleteUser"] },
      })
    );
    const config = loadConfigFile(filePath);
    expect(config).toEqual({
      spec: "https://api.example.com/openapi.yaml",
      auth: { apiKey: "key123" },
      options: { exclude: ["deleteUser"] },
    });
  });

  it("throws when config file contains a YAML array instead of object", () => {
    const filePath = join(tmpDir, "bad-config.yml");
    writeFileSync(filePath, "- item1\n- item2\n");
    expect(() => loadConfigFile(filePath)).toThrow("must contain a YAML/JSON object");
  });

  it("returns null when no config file is present", () => {
    expect(loadConfigFile()).toBeNull();
  });

  it("auto-discovers api-to-mcp.yml in cwd", () => {
    writeFileSync(
      join(tmpDir, "api-to-mcp.yml"),
      `spec: https://example.com/openapi.yaml
auth:
  token: raw-token
`
    );
    const config = loadConfigFile();
    expect(config).toEqual({
      spec: "https://example.com/openapi.yaml",
      auth: { token: "raw-token" },
    });
  });

  it("auto-discovers api-to-mcp.yaml (alternate extension) in cwd", () => {
    writeFileSync(
      join(tmpDir, "api-to-mcp.yaml"),
      "spec: https://example.com/openapi.yaml\n"
    );
    const config = loadConfigFile();
    expect(config?.spec).toBe("https://example.com/openapi.yaml");
  });

  it("auto-discovers api-to-mcp.json in cwd", () => {
    writeFileSync(
      join(tmpDir, "api-to-mcp.json"),
      JSON.stringify({ spec: "https://example.com/openapi.json" })
    );
    const config = loadConfigFile();
    expect(config?.spec).toBe("https://example.com/openapi.json");
  });

  it("warns about unknown top-level keys in config file", () => {
    const filePath = join(tmpDir, "warn-config.yml");
    writeFileSync(filePath, "spec: https://example.com/openapi.yaml\nbarer: typo\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try {
      loadConfigFile(filePath);
    } finally {
      process.stderr.write = orig;
    }
    expect(stderrWrites.some((w) => w.includes("unknown config key 'barer'"))).toBe(true);
  });

  it("warns about unknown auth keys in config file", () => {
    const filePath = join(tmpDir, "warn-auth.yml");
    writeFileSync(filePath, "auth:\n  bearer: tok\n  typoKey: oops\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try {
      loadConfigFile(filePath);
    } finally {
      process.stderr.write = orig;
    }
    expect(stderrWrites.some((w) => w.includes("unknown auth key 'typoKey'"))).toBe(true);
  });

  it("warns about unknown options keys in config file", () => {
    const filePath = join(tmpDir, "warn-opts.yml");
    writeFileSync(filePath, "options:\n  readonly: true\n  onli: [getUsers]\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try {
      loadConfigFile(filePath);
    } finally {
      process.stderr.write = orig;
    }
    expect(stderrWrites.some((w) => w.includes("unknown options key 'onli'"))).toBe(true);
  });

  it("warns when options.only is a string instead of array", () => {
    const filePath = join(tmpDir, "bad-only.yml");
    writeFileSync(filePath, "options:\n  only: getUser\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("options.only must be an array"))).toBe(true);
  });

  it("warns when options.exclude is a string instead of array", () => {
    const filePath = join(tmpDir, "bad-exclude.yml");
    writeFileSync(filePath, "options:\n  exclude: deleteUser\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("options.exclude must be an array"))).toBe(true);
  });

  it("warns when options.bind is an array instead of object", () => {
    const filePath = join(tmpDir, "bad-bind.yml");
    writeFileSync(filePath, "options:\n  bind:\n    - key=val\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("options.bind must be an object"))).toBe(true);
  });

  it("warns when options.readonly is a string instead of boolean", () => {
    const filePath = join(tmpDir, "bad-readonly.yml");
    // YAML parses 'yes' as boolean true — use quoted "yes" to keep it as string
    writeFileSync(filePath, 'options:\n  readonly: "yes"\n');
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("options.readonly must be a boolean"))).toBe(true);
  });

  it("warns when auth.headers is a string instead of object", () => {
    const filePath = join(tmpDir, "bad-headers.yml");
    writeFileSync(filePath, "auth:\n  headers: X-Key:value\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("auth.headers must be an object"))).toBe(true);
  });

  it("warns when auth.headers values are not strings", () => {
    const filePath = join(tmpDir, "bad-header-values.yml");
    writeFileSync(filePath, "auth:\n  headers:\n    X-Count: 42\n    X-Enabled: true\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("auth.headers.X-Count must be a string"))).toBe(true);
    expect(stderrWrites.some((w) => w.includes("auth.headers.X-Enabled must be a string"))).toBe(true);
  });

  it("parses overrides as a Record<string, string>", () => {
    const filePath = join(tmpDir, "overrides-config.yml");
    writeFileSync(
      filePath,
      `overrides:
  getFoo: "Custom description for getFoo"
  getBar: "Custom description for getBar"
`
    );
    const config = loadConfigFile(filePath);
    expect(config?.overrides).toEqual({
      getFoo: "Custom description for getFoo",
      getBar: "Custom description for getBar",
    });
  });

  it("warns and drops overrides when value is an array instead of object", () => {
    const filePath = join(tmpDir, "bad-overrides.yml");
    writeFileSync(filePath, "overrides:\n  - getFoo: desc\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try {
      const config = loadConfigFile(filePath);
      expect(config?.overrides).toBeUndefined();
      expect(stderrWrites.some((w) => w.includes("overrides must be an object"))).toBe(true);
    } finally {
      process.stderr.write = orig;
    }
  });

  it("warns when an override value is not a string", () => {
    const filePath = join(tmpDir, "bad-override-value.yml");
    writeFileSync(filePath, "overrides:\n  getFoo: 42\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try { loadConfigFile(filePath); } finally { process.stderr.write = orig; }
    expect(stderrWrites.some((w) => w.includes("overrides.getFoo must be a string"))).toBe(true);
  });

  it("handles overrides: null gracefully", () => {
    const filePath = join(tmpDir, "null-overrides.yml");
    writeFileSync(filePath, "overrides: null\n");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrWrites.push(String(chunk)); return true; };
    try {
      const config = loadConfigFile(filePath);
      expect(config?.overrides).toBeUndefined();
      expect(stderrWrites.some((w) => w.includes("overrides must be an object"))).toBe(true);
    } finally {
      process.stderr.write = orig;
    }
  });

  it("filters out non-string override values, keeps valid ones", () => {
    const filePath = join(tmpDir, "mixed-overrides.yml");
    writeFileSync(filePath, "overrides:\n  getFoo: valid desc\n  getBar: 42\n");
    process.stderr.write = () => true;
    const config = loadConfigFile(filePath);
    expect(config?.overrides).toEqual({ getFoo: "valid desc" });
  });

  it("prefers api-to-mcp.yml over api-to-mcp.yaml and api-to-mcp.json when multiple exist", () => {
    writeFileSync(join(tmpDir, "api-to-mcp.yml"), "spec: from-yml\n");
    writeFileSync(join(tmpDir, "api-to-mcp.yaml"), "spec: from-yaml\n");
    writeFileSync(
      join(tmpDir, "api-to-mcp.json"),
      JSON.stringify({ spec: "from-json" })
    );
    const config = loadConfigFile();
    expect(config?.spec).toBe("from-yml");
  });
});

describe("mergeEnvWithConfig", () => {
  it("uses config auth values when env has no overrides", () => {
    const result = mergeEnvWithConfig(
      {},
      { token: "raw-tok", bearer: "bearer-tok", apiKey: "key-123" }
    );
    expect(result).toMatchObject({
      API2MCP_AUTH_TOKEN: "raw-tok",
      API2MCP_BEARER_TOKEN: "bearer-tok",
      API2MCP_API_KEY: "key-123",
    });
  });

  it("env vars override config auth values", () => {
    const result = mergeEnvWithConfig(
      {
        API2MCP_AUTH_TOKEN: "env-token",
        API2MCP_BEARER_TOKEN: "env-bearer",
        API2MCP_API_KEY: "env-key",
      },
      { token: "config-token", bearer: "config-bearer", apiKey: "config-key" }
    );
    expect(result.API2MCP_AUTH_TOKEN).toBe("env-token");
    expect(result.API2MCP_BEARER_TOKEN).toBe("env-bearer");
    expect(result.API2MCP_API_KEY).toBe("env-key");
  });

  it("returns env unchanged when auth is undefined", () => {
    const env = { SOME_VAR: "value", API2MCP_BEARER_TOKEN: "existing" };
    const result = mergeEnvWithConfig(env, undefined);
    expect(result).toEqual(env);
  });

  it("returns env unchanged when auth is empty object", () => {
    const env = { SOME_VAR: "value" };
    const result = mergeEnvWithConfig(env, {});
    expect(result).toEqual(env);
  });

  it("does not add undefined auth keys to result", () => {
    const result = mergeEnvWithConfig({}, { token: "tok" });
    expect(result.API2MCP_AUTH_TOKEN).toBe("tok");
    expect("API2MCP_BEARER_TOKEN" in result).toBe(false);
    expect("API2MCP_API_KEY" in result).toBe(false);
  });

  it("preserves non-auth env vars alongside config auth defaults", () => {
    const result = mergeEnvWithConfig(
      { MY_VAR: "hello", PATH: "/usr/bin" },
      { bearer: "tok" }
    );
    expect(result.MY_VAR).toBe("hello");
    expect(result.PATH).toBe("/usr/bin");
    expect(result.API2MCP_BEARER_TOKEN).toBe("tok");
  });
});
