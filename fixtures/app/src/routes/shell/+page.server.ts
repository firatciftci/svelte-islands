import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const csr = false;

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  return {
    staticRows: part("shell.static", rowsFor("shell-static", seed)),
    small: part("shell.small", ["one", "two", seed]),
    deferredRows: part("shell.deferred", rowsFor("shell-deferred", seed)),
    clientRows: part("shell.client", rowsFor("shell-client", seed)),
  };
};
