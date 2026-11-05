import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const prerender = true;

export const load = () => ({
  staticRows: part("prerendered.static", rowsFor("static", "prerendered")),
  deferredRows: part(
    "prerendered.deferred",
    rowsFor("deferred", "prerendered"),
  ),
  clientRows: part("prerendered.client", rowsFor("client", "prerendered")),
});
