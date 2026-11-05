import { part } from "svelte-islands/server";
import { rowsFor } from "#lib/data.js";

export const load = ({ url }) => {
  const seed = url.searchParams.get("seed") ?? "";
  const count = Number(url.searchParams.get("count") ?? 40);
  return {
    rows: part(
      `devtools.rows.${seed}`,
      rowsFor("devtools", seed).slice(0, count),
    ),
  };
};
