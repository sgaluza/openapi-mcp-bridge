import chalk from "chalk";

/**
 * Parse --bind flags of the form "key=value" into a bindings map.
 * - Splits on the first `=` only, so values may contain `=`.
 * - Warns and skips malformed entries (missing `=` or empty key).
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
    const value = flag.slice(eqIdx + 1);
    if (!key) {
      process.stderr.write(chalk.yellow(`Warning: ignoring --bind with empty key: ${flag}\n`));
      continue;
    }
    bindings[key] = value;
  }
  return bindings;
}
