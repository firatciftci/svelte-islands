import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  return {
    eagerRows: part("eager.rows", rowsFor("eager", seed)),
    laterRows: part("later.rows", rowsFor("later", seed)),
  };
};
