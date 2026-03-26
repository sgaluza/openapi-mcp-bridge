import chalk from "chalk";

/** Configuration for JWT password-based authentication */
export interface JwtAuthConfig {
  /** POST endpoint for username/password login */
  loginUrl: string;
  /** JSON body field name for username (default: "username") */
  usernameField: string;
  /** JSON body field name for password (default: "password") */
  passwordField: string;
  /**
   * Dot-path to the JWT string in the login/refresh response.
   * Examples: "token", "jwt", "data.access_token", "$.jwt"
   */
  tokenPath: string;
  /** Optional dedicated refresh endpoint — if absent, re-login on expiry */
  refreshUrl?: string;
  /** Username loaded from API2MCP_USERNAME */
  username: string;
  /** Password loaded from API2MCP_PASSWORD */
  password: string;
}

/** Refresh token 5 minutes before it expires */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Manages JWT authentication lifecycle: login, proactive refresh, and 401 retry.
 *
 * Token is obtained lazily on first `getHeaders()` call, then refreshed
 * proactively 5 minutes before expiry. Concurrent calls are deduplicated —
 * only one login/refresh request is made even if multiple calls arrive simultaneously.
 *
 * Usage:
 *   const auth = new JwtAuthManager(config);
 *   // before each request:
 *   const headers = await auth.getHeaders();
 *   // on 401:
 *   const headers = await auth.getHeaders(true);
 */
export class JwtAuthManager {
  private token: string | null = null;
  private expMs: number | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly config: JwtAuthConfig) {}

  /**
   * Returns an Authorization header map with a valid Bearer JWT.
   *
   * @param forceRefresh - Force token refresh (e.g. after a 401 response)
   */
  async getHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const token = await this.getToken(forceRefresh);
    return { Authorization: `Bearer ${token}` };
  }

  private async getToken(forceRefresh: boolean): Promise<string> {
    if (forceRefresh || !this.token || this.isExpiringSoon()) {
      return this.deduplicatedRefresh();
    }
    return this.token;
  }

  private isExpiringSoon(): boolean {
    if (this.expMs === null) return true;
    return Date.now() >= this.expMs - REFRESH_MARGIN_MS;
  }

  /**
   * Ensures only one refresh is in-flight at a time.
   * Concurrent callers all await the same promise.
   */
  private deduplicatedRefresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const isInitial = !this.token;
    const label = isInitial ? "logging in" : "refreshing token";
    const icon = isInitial ? "🔐" : "🔄";

    process.stderr.write(chalk.cyan(icon) + ` JWT auth: ${label}...\n`);

    try {
      const token =
        !isInitial && this.config.refreshUrl
          ? await this.callRefresh()
          : await this.callLogin();

      this.token = token;
      this.expMs = decodeJwtExp(token);
      this.scheduleProactiveRefresh();

      const expiresInMin =
        this.expMs !== null ? Math.round((this.expMs - Date.now()) / 60_000) : null;
      const expInfo = expiresInMin !== null ? `, expires in ${expiresInMin} min` : "";
      process.stderr.write(
        chalk.green("✓") + ` JWT auth: token ${isInitial ? "obtained" : "refreshed"}${expInfo}\n`
      );

      return token;
    } catch (error) {
      process.stderr.write(
        chalk.red("✗") +
          ` JWT auth: ${label} failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      throw error;
    }
  }

  private async callLogin(): Promise<string> {
    const { loginUrl, usernameField, passwordField, username, password, tokenPath } = this.config;

    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [usernameField]: username, [passwordField]: password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }

    return extractToken((await res.json()) as unknown, tokenPath);
  }

  private async callRefresh(): Promise<string> {
    const { refreshUrl, tokenPath } = this.config;

    const res = await fetch(refreshUrl!, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      process.stderr.write(
        chalk.yellow("⚠") + " JWT auth: refresh endpoint failed, falling back to re-login\n"
      );
      return this.callLogin();
    }

    const data = (await res.json()) as unknown;
    try {
      return extractToken(data, tokenPath);
    } catch {
      process.stderr.write(
        chalk.yellow("⚠") +
          " JWT auth: token not found in refresh response, falling back to re-login\n"
      );
      return this.callLogin();
    }
  }

  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.expMs === null) return;

    const delay = this.expMs - Date.now() - REFRESH_MARGIN_MS;
    if (delay <= 0) return;

    this.refreshTimer = setTimeout(() => {
      process.stderr.write(chalk.cyan("🔄") + " JWT auth: proactive token refresh triggered\n");
      this.deduplicatedRefresh().catch((err: unknown) => {
        process.stderr.write(
          chalk.red("✗") +
            ` JWT auth: proactive refresh failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      });
    }, delay);

    // Don't keep the process alive just for a refresh timer
    this.refreshTimer.unref?.();
  }
}

/**
 * Extract a token string from a response object using a dot-path.
 * Supports "token", "data.access_token", and "$.jwt" formats.
 *
 * @throws Error if the value at the path is not a string
 */
function extractToken(data: unknown, path: string): string {
  const normalised = path.startsWith("$.") ? path.slice(2) : path;
  const value = normalised.split(".").reduce((acc: unknown, key) => {
    if (acc !== null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);

  if (typeof value !== "string") {
    throw new Error(`Token not found at path '${path}' in response`);
  }
  return value;
}

/**
 * Decode the `exp` claim from a JWT payload.
 *
 * @returns Unix timestamp in **milliseconds**, or null if decoding fails.
 */
export function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (typeof payload.exp === "number") return payload.exp * 1000;
    return null;
  } catch {
    return null;
  }
}
