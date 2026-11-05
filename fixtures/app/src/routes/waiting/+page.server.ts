import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export function load() {
  return {
    staticRows: part("waiting.static", rowsFor("waiting static")),
    deferredRows: part("waiting.deferred", rowsFor("waiting deferred")),
    clientRows: part("waiting.client", rowsFor("waiting client")),
  };
}
