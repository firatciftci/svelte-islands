import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = () => ({
  rows: part("inferred.rows", rowsFor("inferred")),
});
