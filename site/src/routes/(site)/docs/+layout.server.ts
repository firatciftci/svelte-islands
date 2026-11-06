import { navigation } from "#lib/server/docs.js";

export function load() {
  return { nav: navigation() };
}
