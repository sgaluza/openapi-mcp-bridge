import chalk from "chalk";

/** Reserved parameter names that cannot be pre-bound. */
const RESERVED_PARAMS = new Set(["body"]);

/**
 * Parse --bind flags of the form "key=value" into a bindings map.
 * - Splits on the first `=` only, so values may contain `=`.
 * - Trims whitespace from both key and value.
 * - Warns and skips malformed entries (missing `=`, empty key, reserved names).
 */
export function parseBindings(flags: string[]): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const flag of flags) {
    const eqIdx = flag.indexOf("=");
    if (eqIdx === -1) {
      process.stderr.write(chalk.yellow(`Warning: ignoring malformed --bind value (missing '='): ${flag}\n`));
      continue;
    }
    const key = flag.slice(0, eqIdx).trim();
    const value = flag.slice(eqIdx + 1).trim();
    if (!key) {
      process.stderr.write(chalk.yellow(`Warning: ignoring --bind with empty key: ${flag}\n`));
      continue;
    }
    if (RESERVED_PARAMS.has(key)) {
      process.stderr.write(chalk.yellow(
        `Warning: cannot bind reserved parameter '${key}' — skipping.\n` +
        `Hint: body fields cannot be pre-bound individually; use a custom header or spec instead.\n`
      ));
      continue;
    }
    bindings[key] = value;
  }
  return bindings;
}
