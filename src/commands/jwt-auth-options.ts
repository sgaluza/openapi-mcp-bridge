import chalk from "chalk";
import { JwtAuthManager } from "../jwt-auth.js";
import { AUTH_OPTIONS, resolveOption } from "../options-schema.js";
import type { ConfigFile } from "../config-file.js";

/**
 * Execute a call and retry once with a force-refreshed JWT token on HTTP 401.
 * Logs a warning when 401 is detected and an error if the retry also fails.
 *
 * @param executeFn - Factory that builds and executes the request with given headers
 * @param jwtAuth   - Active JwtAuthManager, or null if JWT auth is not configured
 * @param staticHeaders - Non-JWT headers (bearer, api-key, cli headers)
 */
export async function executeWithJwtRetry<T extends { isError: boolean; httpStatus?: number }>(
  executeFn: (headers: Record<string, string>) => Promise<T>,
  jwtAuth: JwtAuthManager | null,
  staticHeaders: Record<string, string>
): Promise<T> {
  const jwtHeaders = jwtAuth ? await jwtAuth.getHeaders() : {};
  const result = await executeFn({ ...staticHeaders, ...jwtHeaders });

  if (result.isError && result.httpStatus === 401 && jwtAuth) {
    process.stderr.write(chalk.yellow("⚠") + " JWT auth: received 401, refreshing token and retrying...\n");
    const freshHeaders = await jwtAuth.getHeaders(true);
    const retryResult = await executeFn({ ...staticHeaders, ...freshHeaders });
    if (retryResult.isError && retryResult.httpStatus === 401) {
      process.stderr.write(chalk.red("✗") + " JWT auth: retry after token refresh also failed with 401\n");
    }
    return retryResult;
  }

  return result;
}

/** Shared JWT auth help text appended to both `rest` and `graphql` --help output */
export const JWT_AUTH_HELP = `
JWT password auth env vars:
  API2MCP_AUTH_TYPE            Auth type: jwt-password
  API2MCP_AUTH_LOGIN_URL       Login endpoint URL
  API2MCP_AUTH_USERNAME_FIELD  Request body field for username (default: username)
  API2MCP_AUTH_PASSWORD_FIELD  Request body field for password (default: password)
  API2MCP_AUTH_TOKEN_PATH      Dot-path to JWT in login response (default: token)
  API2MCP_AUTH_REFRESH_URL     Refresh endpoint (optional — default: re-login on expiry)
  API2MCP_USERNAME             Username for jwt-password auth
  API2MCP_PASSWORD             Password for jwt-password auth`;

interface AuthOpts {
  authType?: string;
  authLoginUrl?: string;
  authUsernameField?: string;
  authPasswordField?: string;
  authTokenPath?: string;
  authRefreshUrl?: string;
}

/**
 * Build a JwtAuthManager from CLI opts + env + config file.
 * Returns null if jwt-password auth is not configured.
 * Exits the process with an error message if required fields are missing.
 */
export function buildJwtAuth(
  opts: AuthOpts,
  configFile: ConfigFile | null,
  env: Record<string, string | undefined>
): JwtAuthManager | null {
  const resolve = (key: string, cliVal: unknown) => {
    const def = AUTH_OPTIONS.find((d) => d.key === key);
    /* v8 ignore next */
    if (!def) throw new Error(`Internal: auth option '${key}' not found in AUTH_OPTIONS`);
    return resolveOption(def, cliVal, env, configFile);
  };

  const authType = resolve("authType", opts.authType);
  if (authType !== "jwt-password") return null;

  const loginUrl = resolve("authLoginUrl", opts.authLoginUrl);
  if (!loginUrl) {
    process.stderr.write(
      chalk.red(
        "Error: --auth-login-url (or API2MCP_AUTH_LOGIN_URL / auth.loginUrl) is required for jwt-password auth\n"
      )
    );
    process.exit(1);
  }
  try { new URL(loginUrl); } catch {
    process.stderr.write(chalk.red(`Error: --auth-login-url must be a valid URL, got: ${loginUrl}\n`));
    process.exit(1);
  }

  const refreshUrl = resolve("authRefreshUrl", opts.authRefreshUrl);
  if (refreshUrl) {
    try { new URL(refreshUrl); } catch {
      process.stderr.write(chalk.red(`Error: --auth-refresh-url must be a valid URL, got: ${refreshUrl}\n`));
      process.exit(1);
    }
  }

  const username = env.API2MCP_USERNAME;
  const password = env.API2MCP_PASSWORD;
  if (!username || !password) {
    process.stderr.write(
      chalk.red(
        "Error: API2MCP_USERNAME and API2MCP_PASSWORD env vars are required for jwt-password auth\n"
      )
    );
    process.exit(1);
  }

  return new JwtAuthManager({
    loginUrl,
    usernameField: resolve("authUsernameField", opts.authUsernameField) as string,
    passwordField: resolve("authPasswordField", opts.authPasswordField) as string,
    tokenPath: resolve("authTokenPath", opts.authTokenPath) as string,
    refreshUrl,
    username,
    password,
  });
}
