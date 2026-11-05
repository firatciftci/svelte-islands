import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  return {
    staticRows: part("static.rows", rowsFor("static", seed)),
    deferredRows: part("deferred.rows", rowsFor("deferred", seed)),
    clientRows: part("client.rows", rowsFor("client", seed)),
    neverRows: part("never.rows", rowsFor("never", seed)),
  };
};
