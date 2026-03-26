import { describe, it, expect, vi, beforeEach } from "vitest";
import { JwtAuthManager, decodeJwtExp } from "../src/jwt-auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Build a minimal JWT with the given exp claim (seconds) */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user", exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

const BASE_CONFIG = {
  loginUrl: "https://api.example.com/auth/login",
  usernameField: "userName",
  passwordField: "password",
  tokenPath: "jwt",
  username: "testuser",
  password: "testpass",
};

const FAR_FUTURE_EXP = Math.floor(Date.now() / 1000) + 7200; // 2 hours

function mockLogin(token: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ jwt: token }),
  });
}

// ─── decodeJwtExp ─────────────────────────────────────────────────────────────

describe("decodeJwtExp", () => {
  it("returns exp * 1000 for valid JWT", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(decodeJwtExp(makeJwt(exp))).toBe(exp * 1000);
  });

  it("returns null for malformed token (< 3 parts)", () => {
    expect(decodeJwtExp("not-a-jwt")).toBeNull();
    expect(decodeJwtExp("a.b")).toBeNull();
  });

  it("returns null when payload is not valid base64 JSON", () => {
    expect(decodeJwtExp("a.!!!.c")).toBeNull();
  });

  it("returns null when exp claim is missing", () => {
    const header = Buffer.from("{}").toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString("base64url");
    expect(decodeJwtExp(`${header}.${payload}.sig`)).toBeNull();
  });
});

// ─── JwtAuthManager ──────────────────────────────────────────────────────────

describe("JwtAuthManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── login ────────────────────────────────────────────────────────────────

  it("calls login on first getHeaders()", async () => {
    const token = makeJwt(FAR_FUTURE_EXP);
    mockLogin(token);

    const manager = new JwtAuthManager(BASE_CONFIG);
    const headers = await manager.getHeaders();

    expect(headers).toEqual({ Authorization: `Bearer ${token}` });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userName: "testuser", password: "testpass" }),
      })
    );
  });

  it("reuses cached token on subsequent calls", async () => {
    const token = makeJwt(FAR_FUTURE_EXP);
    mockLogin(token);

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();
    await manager.getHeaders();
    await manager.getHeaders();

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("force-refreshes when getHeaders(true) is called", async () => {
    const token1 = makeJwt(FAR_FUTURE_EXP);
    const token2 = makeJwt(FAR_FUTURE_EXP + 100);
    mockLogin(token1);
    mockLogin(token2);

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();
    const headers = await manager.getHeaders(true);

    expect(headers).toEqual({ Authorization: `Bearer ${token2}` });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("re-logins when token is expiring soon (< 5 min left)", async () => {
    const soonExp = Math.floor(Date.now() / 1000) + 60; // 1 min left
    const token1 = makeJwt(soonExp);
    const token2 = makeJwt(FAR_FUTURE_EXP);
    mockLogin(token1);
    mockLogin(token2);

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders(); // login, gets expiring token
    const headers = await manager.getHeaders(); // should re-login

    expect(headers).toEqual({ Authorization: `Bearer ${token2}` });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("re-logins when token has no exp claim", async () => {
    const noExp = "a.b.c"; // invalid JWT → decodeJwtExp returns null → isExpiringSoon = true
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jwt: noExp }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jwt: noExp }) });

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();
    await manager.getHeaders(); // always re-logins when exp unknown

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent getHeaders() calls (only one login)", async () => {
    const token = makeJwt(FAR_FUTURE_EXP);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ jwt: token }) });

    const manager = new JwtAuthManager(BASE_CONFIG);
    const [h1, h2, h3] = await Promise.all([
      manager.getHeaders(),
      manager.getHeaders(),
      manager.getHeaders(),
    ]);

    expect(h1).toEqual(h2);
    expect(h2).toEqual(h3);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws on login failure with HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid credentials",
    });

    const manager = new JwtAuthManager(BASE_CONFIG);
    await expect(manager.getHeaders()).rejects.toThrow("HTTP 401 Unauthorized");
  });

  it("throws on login timeout (AbortError)", async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));

    const manager = new JwtAuthManager(BASE_CONFIG);
    await expect(manager.getHeaders()).rejects.toThrow("aborted");
  });

  it("logs non-Error rejection as string during login", async () => {
    mockFetch.mockRejectedValueOnce("connection refused");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const manager = new JwtAuthManager(BASE_CONFIG);
    await expect(manager.getHeaders()).rejects.toBe("connection refused");

    const output = stderrSpy.mock.calls.flat().join("");
    expect(output).toContain("connection refused");
    stderrSpy.mockRestore();
  });

  it("throws when token not found at tokenPath", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ wrong_field: "tok" }),
    });

    const manager = new JwtAuthManager(BASE_CONFIG); // tokenPath: "jwt"
    await expect(manager.getHeaders()).rejects.toThrow("Token not found at path 'jwt'");
  });

  // ── tokenPath formats ─────────────────────────────────────────────────────

  it("resolves nested dot-path (data.access_token)", async () => {
    const token = makeJwt(FAR_FUTURE_EXP);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { access_token: token } }),
    });

    const manager = new JwtAuthManager({ ...BASE_CONFIG, tokenPath: "data.access_token" });
    const headers = await manager.getHeaders();
    expect(headers).toEqual({ Authorization: `Bearer ${token}` });
  });

  it("resolves $.jwt JSONPath-style path", async () => {
    const token = makeJwt(FAR_FUTURE_EXP);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jwt: token }),
    });

    const manager = new JwtAuthManager({ ...BASE_CONFIG, tokenPath: "$.jwt" });
    const headers = await manager.getHeaders();
    expect(headers).toEqual({ Authorization: `Bearer ${token}` });
  });

  // ── refresh URL ───────────────────────────────────────────────────────────

  it("calls refresh URL on force-refresh when refreshUrl is set", async () => {
    const token1 = makeJwt(FAR_FUTURE_EXP);
    const token2 = makeJwt(FAR_FUTURE_EXP + 100);
    const config = { ...BASE_CONFIG, refreshUrl: "https://api.example.com/auth/refresh" };

    mockLogin(token1);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jwt: token2 }) });

    const manager = new JwtAuthManager(config);
    await manager.getHeaders();
    const headers = await manager.getHeaders(true);

    expect(headers).toEqual({ Authorization: `Bearer ${token2}` });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.example.com/auth/refresh");
    expect(mockFetch.mock.calls[1][1]).toMatchObject({
      method: "GET",
      headers: { Authorization: `Bearer ${token1}` },
    });
  });

  it("falls back to login if refresh endpoint returns non-OK", async () => {
    const token1 = makeJwt(FAR_FUTURE_EXP);
    const token2 = makeJwt(FAR_FUTURE_EXP + 100);
    const config = { ...BASE_CONFIG, refreshUrl: "https://api.example.com/auth/refresh" };

    mockLogin(token1);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" });
    mockLogin(token2);

    const manager = new JwtAuthManager(config);
    await manager.getHeaders();
    const headers = await manager.getHeaders(true);

    expect(headers).toEqual({ Authorization: `Bearer ${token2}` });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── extractToken edge cases ───────────────────────────────────────────────

  it("throws when intermediate path segment is not an object", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: "not-an-object" }),
    });

    // tokenPath "data.token" → data is a string, not an object → can't traverse further
    const manager = new JwtAuthManager({ ...BASE_CONFIG, tokenPath: "data.token" });
    await expect(manager.getHeaders()).rejects.toThrow("Token not found at path 'data.token'");
  });

  // ── proactive refresh ─────────────────────────────────────────────────────

  it("triggers proactive refresh before token expiry", async () => {
    vi.useFakeTimers();

    // Token expires in 10 min → proactive refresh fires in 10*60 - 5*60 = 5 min
    const soonExp = Math.floor(Date.now() / 1000) + 10 * 60;
    const token1 = makeJwt(soonExp);
    const token2 = makeJwt(FAR_FUTURE_EXP);
    mockLogin(token1);
    mockLogin(token2);

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();
    expect(mockFetch).toHaveBeenCalledOnce();

    // Advance past the proactive refresh threshold (5 min + 1s margin)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("logs Error instance when proactive refresh fails", async () => {
    vi.useFakeTimers();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const soonExp = Math.floor(Date.now() / 1000) + 10 * 60;
    const token1 = makeJwt(soonExp);
    mockLogin(token1);
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    await Promise.resolve();

    const errorOutput = stderrSpy.mock.calls.flat().join("");
    expect(errorOutput).toContain("proactive refresh failed");
    expect(errorOutput).toContain("network error");

    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  it("logs non-Error when proactive refresh fails with string rejection", async () => {
    vi.useFakeTimers();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const soonExp = Math.floor(Date.now() / 1000) + 10 * 60;
    const token1 = makeJwt(soonExp);
    mockLogin(token1);
    mockFetch.mockRejectedValueOnce("timeout");

    const manager = new JwtAuthManager(BASE_CONFIG);
    await manager.getHeaders();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    await Promise.resolve();

    const errorOutput = stderrSpy.mock.calls.flat().join("");
    expect(errorOutput).toContain("proactive refresh failed");
    expect(errorOutput).toContain("timeout");

    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  it("falls back to login if token not found in refresh response", async () => {
    const token1 = makeJwt(FAR_FUTURE_EXP);
    const token2 = makeJwt(FAR_FUTURE_EXP + 100);
    const config = { ...BASE_CONFIG, refreshUrl: "https://api.example.com/auth/refresh" };

    mockLogin(token1);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ wrong: "data" }) });
    mockLogin(token2);

    const manager = new JwtAuthManager(config);
    await manager.getHeaders();
    const headers = await manager.getHeaders(true);

    expect(headers).toEqual({ Authorization: `Bearer ${token2}` });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
