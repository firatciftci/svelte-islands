import { error } from "@sveltejs/kit";
import { harbors } from "#lib/harrow.js";
import { pageAt, pages } from "#lib/server/docs.js";

export const csr = false;

export function entries() {
  return [{ slug: "home" }, ...pages.map(({ slug }) => ({ slug }))];
}

function seeded(text: string) {
  let state = 2166136261;
  for (const character of text) {
    state = Math.imul(state ^ (character.codePointAt(0) ?? 0), 16777619);
  }
  return () => {
    state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0;
    return state / 4294967296;
  };
}

export function load({ params }) {
  if (params.slug === "home") {
    return { kind: "home" as const, rows: harbors(200, 7) };
  }
  const found = pageAt(params.slug);
  if (found == null) {
    error(404);
  }
  const next = seeded(found.slug);
  const bars: Array<number> = [];
  for (let row = 0; row < 6; row += 1) {
    bars.push(row === 0 ? 0.45 + next() * 0.2 : 0.55 + next() * 0.45);
  }
  return {
    kind: "page" as const,
    section: found.section,
    title: found.title,
    description: found.description,
    bars,
    tide: { x: 20 + next() * 60, y: next() < 0.5 ? 0 : 100 },
  };
}
