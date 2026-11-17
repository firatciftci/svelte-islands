import { visitorParts } from "#lib/visitor.js";

export const load = async ({ cookies, setHeaders }) => {
  setHeaders({ "cache-control": "public, max-age=60" });
  return visitorParts(cookies);
};
