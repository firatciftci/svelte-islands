import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  return {
    rows: part("scope.rows", rowsFor("scope", seed)),
    small: part("scope.small", ["one", "two", seed]),
  };
};
