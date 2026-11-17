import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const csr = false;

export const load = () => ({
  rows: part("shell.function", rowsFor("shell-function")),
});
