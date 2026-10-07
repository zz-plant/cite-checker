import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ExtractOptions } from "./extract.ts";
import type { RunOptions } from "./check.ts";
import type { ArchiveOptions } from "./archive.ts";

export interface CiteCheckConfig {
  /** Globs of the files that carry claims, relative to the config's directory. */
  files: string[];
  /**
   * Who is asking, e.g. "example.org source verification you@example.org".
   * Required: SEC and Crossref both want a contactable requester.
   */
  userAgent: string;
  /** Where `check --write` records the run. Default: `source-checks.json`. */
  snapshot?: string;
  extract?: ExtractOptions;
  check?: Omit<RunOptions, "userAgent" | "fetch" | "onResult">;
  archive?: {
    /** Globs of the Markdown files whose evidence blocks get captures. Default: `files`. */
    files?: string[];
  } & Omit<ArchiveOptions, "userAgent" | "fetch" | "sleep">;
}

export function defineConfig(config: CiteCheckConfig): CiteCheckConfig {
  return config;
}

export const CONFIG_NAMES = [
  "cite-check.config.ts",
  "cite-check.config.mts",
  "cite-check.config.js",
  "cite-check.config.mjs",
  "cite-check.config.json",
];

/** The config at `path`, or the first `cite-check.config.*` found in `cwd`. */
export async function loadConfig(
  cwd: string,
  path?: string
): Promise<{ config: CiteCheckConfig; file: string }> {
  const candidates = path ? [resolve(cwd, path)] : CONFIG_NAMES.map((name) => resolve(cwd, name));
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) {
    throw new Error(
      path
        ? `No config at ${path}`
        : `No cite-check config found in ${cwd} (looked for ${CONFIG_NAMES.join(", ")})`
    );
  }
  const loaded = (await import(pathToFileURL(file).href)) as {
    default?: CiteCheckConfig;
  } & CiteCheckConfig;
  const config = loaded.default ?? loaded;
  if (!Array.isArray(config.files) || !config.files.length)
    throw new Error(`${file}: "files" must list at least one glob`);
  if (!config.userAgent)
    throw new Error(`${file}: "userAgent" is required — say who is asking and how to reach you`);
  return { config, file };
}
