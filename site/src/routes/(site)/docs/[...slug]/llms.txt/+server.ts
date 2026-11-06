import { error } from "@sveltejs/kit";
import { pageAt, pages } from "#lib/server/docs.js";

export const prerender = true;

export function entries() {
  return pages.map(({ slug }) => ({ slug }));
}

export function GET({ params }) {
  const found = pageAt(params.slug);
  if (found == null) {
    error(404);
  }
  return new Response(`# ${found.title}\n\n${found.markdown}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
