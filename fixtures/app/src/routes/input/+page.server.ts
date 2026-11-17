import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  return {
    formRows: part("form.rows", rowsFor("form", seed)),
    eitherRows: part("either.rows", rowsFor("either", seed)),
    nearRows: part("near.rows", rowsFor("near", seed)),
  };
};
