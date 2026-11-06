import { navigation, pages } from "#lib/server/docs.js";
import { SITE_URL } from "#lib/site.js";

export const prerender = true;

export function GET() {
  const lines = [
    "# svelte-islands",
    "",
    "> Islands for SvelteKit: content-addressed page data, server HTML adopted without hydration, and skeletons learned from your own markup.",
    "",
  ];
  for (const group of navigation()) {
    lines.push(`## ${group.title}`, "");
    for (const item of group.pages) {
      const page = pages.find(({ slug }) => slug === item.slug);
      lines.push(
        `- [${item.title}](${SITE_URL}/docs/${item.slug}/llms.txt): ${page?.description ?? ""}`,
      );
    }
    lines.push("");
  }
  lines.push(`All of it in one file: ${SITE_URL}/llms-full.txt`, "");
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
