import { pages } from "#lib/server/docs.js";

export const prerender = true;

export function GET() {
  const body = pages
    .map((page) => `# ${page.section}: ${page.title}\n\n${page.markdown}\n`)
    .join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
