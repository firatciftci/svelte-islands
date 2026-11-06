import { part } from "svelte-islands/server";
import { searchIndex } from "#lib/server/search.js";

export function load() {
  return { search: part("search.index", searchIndex(), { fetch: "lazy" }) };
}
