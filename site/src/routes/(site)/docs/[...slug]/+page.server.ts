import { error } from "@sveltejs/kit";
import { part } from "svelte-islands/server";
import { neighbors, pageAt, pages } from "#lib/server/docs.js";
import { modesParts, strategyParts } from "#lib/server/examples.js";

export function entries() {
  return pages.map(({ slug }) => ({ slug }));
}

export function load({ params }) {
  const found = pageAt(params.slug);
  if (found == null) {
    error(404);
  }
  const uses = (name: string) =>
    found.segments.some(
      (segment) => segment.kind === "example" && segment.name === name,
    );
  return {
    slug: found.slug,
    file: found.file,
    section: found.section,
    title: found.title,
    description: found.description,
    headings: found.headings,
    segments: found.segments.map((segment) =>
      segment.kind === "html"
        ? { kind: "html" as const, part: part("docs", segment.html) }
        : segment,
    ),
    modes: uses("modes") ? modesParts() : null,
    strategies: uses("strategies") ? strategyParts() : null,
    ...neighbors(found.slug),
  };
}
