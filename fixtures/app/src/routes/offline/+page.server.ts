import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = () => ({
  rows: part("offline.rows", rowsFor("offline", "offline")),
  later: part("offline.later", rowsFor("later", "offline")),
});
