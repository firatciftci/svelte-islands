import { visitorParts } from "#lib/visitor.js";

export const csr = false;

export const load = ({ cookies }) => visitorParts(cookies);
