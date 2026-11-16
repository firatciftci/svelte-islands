import { pages } from "#lib/server/docs.js";
import { SITE_URL } from "#lib/site.js";

export const prerender = true;

export function GET() {
  const urls = [
    `${SITE_URL}/`,
    ...pages.map(({ slug }) => `${SITE_URL}/docs/${slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
