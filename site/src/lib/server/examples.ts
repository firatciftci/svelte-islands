import { part } from "svelte-islands/server";
import { comments, harbors } from "#lib/harrow.js";

const ROWS = 200;

export function modesParts() {
  return {
    adopted: part("modes.static", harbors(ROWS, 11)),
    deferred: part("modes.deferred", harbors(ROWS, 23)),
    client: part("modes.client", harbors(ROWS, 37)),
  };
}

export function strategyParts() {
  return {
    visible: part("strategy.visible", harbors(ROWS, 41)),
    idle: part("strategy.idle", harbors(ROWS, 43)),
    interaction: part("strategy.interaction", harbors(ROWS, 47)),
    media: part("strategy.media", harbors(ROWS, 53)),
    eager: part("strategy.eager", harbors(ROWS, 59)),
    never: part("strategy.never", harbors(ROWS, 61)),
  };
}

export function commentsParts() {
  const all = comments(40, 71);
  return { count: all.length, comments: part("post.comments", all) };
}

export function dashboardParts() {
  return { harbors: part("dashboard.harbors", harbors(120, 83)) };
}

export function tableParts() {
  const berths = harbors(300, 89);
  return { count: berths.length, berths: part("log.berths", berths) };
}
