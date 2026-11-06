import { pages } from "./docs";

export type Entry = {
  slug: string;
  id: string | null;
  page: string;
  heading: string | null;
  text: string;
};

function tidy(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/^> ?/gmu, "")
    .replace(/\[!\w+\]/gu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/(^|\s)_(\S[^_]*)_/gu, "$1$2")
    .replace(/[`*#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function searchIndex() {
  const entries: Array<Entry> = [];
  for (const page of pages) {
    const pieces = page.markdown.split(/^(?=#{2,3} )/mu);
    let at = 0;
    for (const piece of pieces) {
      const isHeading = /^#{2,3} /u.test(piece);
      const body = isHeading ? piece.slice(piece.indexOf("\n") + 1) : piece;
      const heading = isHeading ? (page.headings[at] ?? null) : null;
      if (isHeading) {
        at += 1;
      }
      entries.push({
        slug: page.slug,
        id: heading?.id ?? null,
        page: page.title,
        heading: heading?.text ?? null,
        text: tidy(body),
      });
    }
  }
  return entries;
}
