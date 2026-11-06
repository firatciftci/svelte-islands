import { part } from "svelte-islands/server";
import { wards } from "#lib/harrow.js";

const ROWS = 200;

export function modesParts() {
  return {
    adopted: part("modes.static", wards(ROWS, 11)),
    deferred: part("modes.deferred", wards(ROWS, 23)),
    client: part("modes.client", wards(ROWS, 37)),
  };
}

export function strategyParts() {
  return {
    visible: part("strategy.visible", wards(ROWS, 41)),
    idle: part("strategy.idle", wards(ROWS, 43)),
    interaction: part("strategy.interaction", wards(ROWS, 47)),
    media: part("strategy.media", wards(ROWS, 53)),
    eager: part("strategy.eager", wards(ROWS, 59)),
    never: part("strategy.never", wards(ROWS, 61)),
  };
}
