import chalk from "chalk";
import type { ToolDefinition } from "../tool-builder.js";

/**
 * Parse and validate --only / --exclude CLI options.
 * - Exits with code 1 if both --only and --exclude are provided (mutual exclusion).
 * - Writes warnings to stderr for unknown operation names in --only or --exclude.
 * - Returns parsed arrays ready for use in filterTools().
 */
export function resolveFilterOptions(
  opts: { only?: string; exclude?: string },
  allTools: ToolDefinition[]
): { only?: string[]; exclude?: string[] } {
  if (opts.only && opts.exclude) {
    process.stderr.write(chalk.red("Error: --only and --exclude are mutually exclusive.\n"));
    process.exit(1);
  }

  const toolNames = new Set(allTools.map((t) => t.name));

  const only = opts.only ? splitCsv(opts.only) : undefined;
  const exclude = opts.exclude ? splitCsv(opts.exclude) : undefined;

  if (only) warnUnknownOps(only, toolNames, "--only");
  if (exclude) warnUnknownOps(exclude, toolNames, "--exclude");

  return { only, exclude };
}

function warnUnknownOps(filter: string[], toolNames: Set<string>, flagName: string): void {
  const unknown = filter.filter((name) => !toolNames.has(name));
  if (unknown.length > 0) {
    process.stderr.write(chalk.yellow(
      `Warning: unknown operations in ${flagName}: ${unknown.join(", ")}\n` +
      `Hint: run without --only/--exclude to see all available operations\n`
    ));
  }
}

/**
 * Split a comma-separated string into a trimmed, non-empty array of values.
 */
export function splitCsv(val: string): string[] {
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}
