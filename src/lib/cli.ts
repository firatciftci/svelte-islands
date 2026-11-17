#!/usr/bin/env node
import process from "node:process";
import { run as check } from "./budget.js";
import { run as init } from "./init.js";
import { run as inspect } from "./inspect.js";

const USAGE = `Usage: svelte-islands <command>

Commands:
  init [<directory>]   Sets up svelte-islands in a SvelteKit app
  inspect <url>        Lists the islands on a page, with --json for scripts
  check <url>          Fails when a page is over its budget

Run svelte-islands <command> --help for a command's options.
`;

const [command, ...rest] = process.argv.slice(2);

if (command === "init") {
  process.exitCode = await init(rest);
} else if (command === "inspect") {
  process.exitCode = await inspect(rest);
} else if (command === "check") {
  process.exitCode = await check(process.argv.slice(2));
} else {
  const isHelp = command === "-h" || command === "--help";
  (isHelp ? process.stdout : process.stderr).write(USAGE);
  process.exitCode = isHelp ? 0 : 2;
}
