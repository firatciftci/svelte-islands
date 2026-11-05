import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export function load() {
  return { rows: part("table.rows", rowsFor("row", "", 300)) };
}
