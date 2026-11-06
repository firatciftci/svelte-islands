import { part } from "svelte-islands/server";
import { districts, places, summary } from "../data";

export function load() {
  return {
    summary,
    districts: part("demo.districts", districts),
    places: part("demo.places", places),
  };
}
