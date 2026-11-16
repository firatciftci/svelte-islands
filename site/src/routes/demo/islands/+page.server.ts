import { part } from "svelte-islands/server";
import { berths, ports, summary } from "../data";

export function load() {
  return {
    summary,
    ports: part("demo.harbors", ports),
    berths: part("demo.berths", berths),
  };
}
