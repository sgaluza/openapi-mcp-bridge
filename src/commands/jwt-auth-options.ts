import chalk from "chalk";
import { JwtAuthManager } from "../jwt-auth.js";
import { AUTH_OPTIONS, resolveOption } from "../options-schema.js";
import type { ConfigFile } from "../config-file.js";

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
  const resolve = (key: string, cliVal: unknown) =>
    resolveOption(AUTH_OPTIONS.find((d) => d.key === key)!, cliVal, env, configFile);

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
    usernameField: resolve("authUsernameField", opts.authUsernameField) ?? "username",
    passwordField: resolve("authPasswordField", opts.authPasswordField) ?? "password",
    tokenPath: resolve("authTokenPath", opts.authTokenPath) ?? "token",
    refreshUrl: resolve("authRefreshUrl", opts.authRefreshUrl),
    username,
    password,
  });
}
