#!/usr/bin/env bun
/**
 *   cite-checker check [--json] [--write] [--config <file>]
 *   cite-checker archive [--write] [--save] [--config <file>]
 *
 * `check` exits 1 if any source is FAIL. A run that ends in a FAIL is still
 * written with --write: the point of publishing the check is that a dead
 * source is shown as dead, not hidden behind a red exit code.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { archiveSources } from "./archive.ts";
import { checkSources, type SourceResult } from "./check.ts";
import { loadConfig } from "./config.ts";
import { collectSources } from "./extract.ts";
import { toSnapshot } from "./snapshot.ts";

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function check(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const { config, file: configFile } = await loadConfig(cwd, option(args, "--config"));
  const root = dirname(configFile);
  const asJson = flag(args, "--json");
  const write = flag(args, "--write");

  const refs = await collectSources(config.files, { ...config.extract, cwd: root });
  const results: SourceResult[] = await checkSources(refs, {
    ...config.check,
    userAgent: config.userAgent,
    onResult: asJson
      ? undefined
      : (r) => {
          const mark = r.verdict === "PASS" ? "✅" : r.verdict === "FAIL" ? "❌" : "⚠️ ";
          console.log(`${mark} ${String(r.status ?? "—").padEnd(4)} ${r.url}`);
          if (r.verdict !== "PASS") console.log(`      ${r.file} — ${r.detail}`);
        },
  });

  const fails = results.filter((r) => r.verdict === "FAIL").length;
  const unknown = results.filter((r) => r.verdict === "UNKNOWN").length;
  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(
      `\n${results.length} cited sources — ${results.length - fails - unknown} verified, ${unknown} unverifiable by machine, ${fails} broken`
    );
    if (unknown) console.log("Unverifiable is not passing. Read those by hand.");
  }

  if (write) {
    const path = resolve(root, config.snapshot ?? "source-checks.json");
    const snapshot = toSnapshot(results, new Date().toISOString().slice(0, 10));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!asJson) console.log(`\nWrote ${path} (${snapshot.sources.length} distinct sources)`);
  }
  return fails ? 1 : 0;
}

async function archive(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const { config, file: configFile } = await loadConfig(cwd, option(args, "--config"));
  const root = dirname(configFile);
  const { files, ...archiveOptions } = config.archive ?? {};
  const outcomes = await archiveSources(files ?? config.files, {
    ...archiveOptions,
    userAgent: config.userAgent,
    cwd: root,
    write: flag(args, "--write"),
    save: flag(args, "--save"),
    log: (line) => console.log(line),
  });
  return outcomes.some((o) => o.status === "NONE" || o.status === "ERROR") ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
let code: number;
if (command === "check") code = await check(rest);
else if (command === "archive") code = await archive(rest);
else {
  console.error(
    "Usage: cite-checker check [--json] [--write] [--config <file>]\n       cite-checker archive [--write] [--save] [--config <file>]"
  );
  code = 2;
}
process.exit(code);
