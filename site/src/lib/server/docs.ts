import { render, type Heading, type Segment } from "./markdown";
import { referencePages } from "./reference";

export type Page = {
  slug: string;
  file: string | null;
  section: string;
  title: string;
  description: string;
  markdown: string;
  segments: Array<Segment>;
  headings: Array<Heading>;
  words: number;
};

const SECTIONS: Record<string, string> = {
  "getting-started": "Getting started",
  "core-concepts": "Core concepts",
  "long-content": "Long content",
  "build-and-deploy": "Build and deploy",
  tooling: "Tooling",
  "best-practices": "Best practices",
  appendix: "Appendix",
};

const sources = import.meta.glob("../../../../docs/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function clean(part: string) {
  return part.replace(/^\d+-/u, "").replace(/\.md$/u, "");
}

function frontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  const fields: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const at = line.indexOf(":");
    if (at !== -1) {
      fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return { fields, body: source.slice(match?.[0].length ?? 0).trim() };
}

function firstSentence(markdown: string) {
  const prose = markdown
    .split("\n\n")
    .find((block) => /^[A-Za-z`_[]/u.test(block) && !block.startsWith("```"));
  const plain = (prose ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[`_*]/gu, "");
  return /^.*?[.:](?:\s|$)/u.exec(plain)?.[0].trim() ?? plain;
}

const known = new Set<string>();
const raw = Object.entries(sources)
  .toSorted(([a], [b]) => a.localeCompare(b))
  .map(([path, source]) => {
    const inDocs = path.slice(path.indexOf("/docs/") + "/docs/".length);
    const [section = "", page = ""] = inDocs.split("/").map(clean);
    const slug = `${section}/${page}`;
    known.add(slug);
    return { path: inDocs, section, slug, source };
  });

function resolver(from: string) {
  return (href: string) => {
    const [file = "", hash] = href.split("#");
    const parts = from.split("/").slice(0, -1);
    for (const piece of file.split("/")) {
      if (piece === "..") {
        parts.pop();
      } else if (piece !== ".") {
        parts.push(piece);
      }
    }
    const [section = "", page = ""] = parts.map(clean);
    const slug = `${section}/${page}`;
    if (!known.has(slug)) {
      throw new Error(`${from} links to ${href}, which is not a page.`);
    }
    return { slug, hash: hash ?? null };
  };
}

function words(markdown: string) {
  return markdown.split(/\s+/u).filter((word) => /\w/u.test(word)).length;
}

async function loadPages() {
  const made: Array<Page> = [];
  for (const { path, section, slug, source } of raw) {
    const { fields, body } = frontmatter(source);
    const rendered = await render(body, resolver(path));
    made.push({
      slug,
      file: `docs/${path}`,
      section: SECTIONS[section] ?? section,
      title: fields.title ?? slug,
      description: firstSentence(body),
      markdown: body,
      segments: rendered.segments,
      headings: rendered.headings,
      words: words(body),
    });
  }
  const reference = await referencePages(async (markdown) =>
    render(markdown, resolver("reference/x.md")),
  );
  for (const page of reference) {
    made.push({ ...page, file: page.file, words: words(page.markdown) });
  }
  return made;
}

export const pages = await loadPages();

const bySlug = new Map(pages.map((page) => [page.slug, page]));

export function pageAt(slug: string) {
  return bySlug.get(slug) ?? null;
}

export function neighbors(slug: string) {
  const at = pages.findIndex((page) => page.slug === slug);
  const link = (page: Page | undefined) =>
    page == null ? null : { slug: page.slug, title: page.title };
  return { previous: link(pages[at - 1]), next: link(pages[at + 1]) };
}

export function navigation() {
  const groups: Array<{
    title: string;
    pages: Array<{ slug: string; title: string }>;
  }> = [];
  for (const page of pages) {
    const group = groups.at(-1);
    if (group?.title === page.section) {
      group.pages.push({ slug: page.slug, title: page.title });
    } else {
      groups.push({
        title: page.section,
        pages: [{ slug: page.slug, title: page.title }],
      });
    }
  }
  return groups;
}
