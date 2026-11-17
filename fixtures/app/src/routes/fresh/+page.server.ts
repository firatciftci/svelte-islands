import { visitorParts } from "#lib/visitor.js";

export const prerender = true;

export const load = ({ cookies }) => visitorParts(cookies);
