import chalk from "chalk";
import type { ToolDefinition } from "../tool-builder.js";

/**
 * Parse and validate --only / --exclude CLI options.
 * Exits with an error if both are provided simultaneously.
 * Warns on unknown operation names.
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

  if (only) {
    const unknown = only.filter((name) => !toolNames.has(name));
    if (unknown.length > 0) {
      process.stderr.write(chalk.yellow(`Warning: unknown operations in --only: ${unknown.join(", ")}\nHint: run without --only/--exclude to see all available operations\n`));
    }
  }

  if (exclude) {
    const unknown = exclude.filter((name) => !toolNames.has(name));
    if (unknown.length > 0) {
      process.stderr.write(chalk.yellow(`Warning: unknown operations in --exclude: ${unknown.join(", ")}\nHint: run without --only/--exclude to see all available operations\n`));
    }
  }

  return { only, exclude };
}

/**
 * Split a comma-separated string into a trimmed, non-empty array of values.
 */
export function splitCsv(val: string): string[] {
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}
