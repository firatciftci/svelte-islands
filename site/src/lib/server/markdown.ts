import { Marked, type Tokens } from "marked";
import {
  createCssVariablesTheme,
  createHighlighter,
  type DecorationItem,
} from "shiki";
import { check } from "./samples";

export type Heading = {
  id: string;
  text: string;
  level: 2 | 3;
  at: number;
  words: number;
};

export type Segment =
  | { kind: "html"; html: string }
  | { kind: "example"; name: string; at: number };

const EXAMPLE = /^<!-- example: ([\w-]+) -->$/u;
const FILE_COMMENT = /^(?:\/\/\/ file: (.+)|<!--- file: (.+) --->)$/u;
const CALLOUT = /^\[!(NOTE|LEGACY|DETAILS)\][ \t]*(.*)$/u;
const TIPS = /<template data-tips>[\s\S]*?<\/template>/gu;

const theme = createCssVariablesTheme({
  name: "chart",
  variablePrefix: "--code-",
  fontStyle: true,
});

const highlighter = await createHighlighter({
  themes: [theme],
  langs: ["ts", "js", "svelte", "sh", "html", "json", "jsonc", "yaml", "css"],
});

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function slugOf(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/gu, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/gu, "-");
}

const KEPT_TOGETHER = 28;

function plain(tokens: Array<Tokens.Generic> | undefined): string {
  let text = "";
  for (const token of tokens ?? []) {
    text +=
      "tokens" in token && token.tokens != null
        ? plain(token.tokens)
        : (token.text ?? token.raw ?? "");
  }
  return text;
}

const inline = new Marked({ async: false, gfm: true });

function tipOf(signature: string, summary: string) {
  const code = highlighter.codeToHtml(signature, {
    lang: "ts",
    theme: "chart",
    structure: "inline",
  });
  const note =
    summary === ""
      ? ""
      : `<p>${inline.parseInline(summary, { async: false })}</p>`;
  return `<div><code>${code}</code>${note}</div>`;
}

function annotate(body: string, language: string, file: string | null) {
  const { code, hovers } = check(body, language, file);
  const tips: Array<string> = [];
  const decorations: Array<DecorationItem> = [];
  for (const { line, character, length, signature, summary } of hovers) {
    const tip = tipOf(signature, summary);
    const known = tips.indexOf(tip);
    decorations.push({
      start: { line, character },
      end: { line, character: character + length },
      properties: { "data-tip": known === -1 ? tips.push(tip) - 1 : known },
    });
  }
  return {
    code,
    decorations,
    tips:
      tips.length === 0
        ? ""
        : `<template data-tips>${tips.join("")}</template>`,
  };
}

function highlight(code: string, lang: string, isDeclaration: boolean) {
  const lines = code.split("\n");
  const header = FILE_COMMENT.exec(lines[0]?.trim() ?? "");
  const file = header?.[1] ?? header?.[2] ?? null;
  const body = (file == null ? lines : lines.slice(1)).join("\n");
  const language = lang === "" ? "text" : lang;
  const annotated =
    (language === "ts" || language === "js") && !isDeclaration
      ? annotate(body, language, file)
      : { code: body, decorations: [], tips: "" };
  const html = highlighter.codeToHtml(annotated.code, {
    lang: language,
    theme: "chart",
    decorations: annotated.decorations,
  });
  return [
    `<figure class="code" data-lang="${escape(language)}">`,
    file == null
      ? ""
      : `<figcaption class="code-file">${escape(file)}</figcaption>`,
    `<button type="button" class="copy" data-copy aria-label="Copy code"><span class="copy-idle">Copy</span><span class="copy-done">Copied</span></button>`,
    html,
    annotated.tips,
    "</figure>",
  ].join("");
}

export async function render(
  markdown: string,
  link: (href: string) => { slug: string; hash: string | null },
) {
  const headings: Array<Heading> = [];
  const used = new Map<string, number>();
  const base = __BASE__;

  const marked: Marked = new Marked({
    async: false,
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plain(tokens);
        const slug = slugOf(text);
        const seen = used.get(slug) ?? 0;
        used.set(slug, seen + 1);
        const id = seen === 0 ? slug : `${slug}-${seen}`;
        if (depth === 2 || depth === 3) {
          headings.push({ id, text, level: depth, at: 0, words: 0 });
        }
        return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section"></a></h${depth}>`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const titled = title == null ? "" : ` title="${escape(title)}"`;
        if (/^(?:[a-z]+:|#)/iu.test(href)) {
          return `<a href="${escape(href)}"${titled}>${inner}</a>`;
        }
        const { slug, hash } = link(href);
        const target = `${base}/docs/${slug}${hash == null ? "" : `#${hash}`}`;
        return `<a href="${escape(target)}"${titled}>${inner}</a>`;
      },
      codespan({ text }) {
        const kept = text.length <= KEPT_TOGETHER ? ' class="kept"' : "";
        return `<code${kept}>${escape(text)}</code>`;
      },
      code({ text, lang }) {
        const [language = "", kind] = (lang ?? "").split(/\s/u);
        return highlight(text, language, kind === "declaration");
      },
      table(token) {
        const header = token.header
          .map((cell) => {
            const align = cell.align == null ? "" : ` align="${cell.align}"`;
            return `<th scope="col"${align}>${this.parser.parseInline(cell.tokens)}</th>`;
          })
          .join("");
        const rows = token.rows
          .map((row) => {
            const cells = row
              .map((cell) => {
                const align =
                  cell.align == null ? "" : ` align="${cell.align}"`;
                return `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
      blockquote({ tokens }) {
        const first = tokens[0];
        const raw = first?.type === "paragraph" ? first.text : "";
        const [line = "", ...rest] = raw.split("\n");
        const callout = CALLOUT.exec(line);
        if (callout == null) {
          return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
        }
        const kind = callout[1]?.toLowerCase() ?? "note";
        const heading = callout[2] ?? "";
        const leftover = [...rest].join("\n");
        const paragraph =
          leftover === "" ? "" : marked.parse(leftover, { async: false });
        const others = this.parser.parse(tokens.slice(1));
        if (kind === "details") {
          return `<details class="callout"><summary>${marked.parseInline(heading, { async: false })}</summary>${paragraph}${others}</details>`;
        }
        return `<aside class="callout callout-${kind}">${paragraph}${others}</aside>`;
      },
    },
  });

  const blocks: Array<
    { kind: "text"; text: string } | { kind: "example"; name: string }
  > = [];
  let current: Array<string> = [];
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
    }
    const example = inCode ? null : EXAMPLE.exec(line.trim());
    if (example?.[1] == null) {
      current.push(line);
    } else {
      blocks.push({ kind: "text", text: current.join("\n") });
      blocks.push({ kind: "example", name: example[1] });
      current = [];
    }
  }
  blocks.push({ kind: "text", text: current.join("\n") });

  const segments: Array<Segment> = [];
  for (const block of blocks) {
    if (block.kind === "example") {
      segments.push({ kind: "example", name: block.name, at: 0 });
    } else if (block.text.trim() !== "") {
      segments.push({
        kind: "html",
        html: marked.parse(block.text, { async: false }),
      });
    }
  }

  placeOnChart(segments, headings);
  return { segments, headings };
}

const CODE_LINE = 22;
const TEXT_LINE = 1.7;
const EXAMPLE_LENGTH = 700;

function lengthOf(html: string) {
  const lines = html.match(/<span class="line">/gu)?.length ?? 0;
  const text = html
    .replace(/<pre[\s\S]*?<\/pre>/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ");
  return lines * CODE_LINE + text.length * TEXT_LINE;
}

function placeOnChart(segments: Array<Segment>, headings: Array<Heading>) {
  let total = 0;
  const marks = new Map<string, number>();
  const wordsAt: Array<{ id: string; at: number }> = [];
  for (const segment of segments) {
    if (segment.kind === "example") {
      segment.at = total;
      total += EXAMPLE_LENGTH;
      continue;
    }
    const pieces = segment.html.replace(TIPS, "").split(/(?=<h[23] id=")/u);
    for (const piece of pieces) {
      const id = /^<h[23] id="([^"]+)"/u.exec(piece)?.[1];
      if (id != null) {
        marks.set(id, total);
        wordsAt.push({
          id,
          at: piece
            .replace(/<[^>]+>/gu, " ")
            .split(/\s+/u)
            .filter((word) => /\w/u.test(word)).length,
        });
      }
      total += lengthOf(piece);
    }
  }
  const safe = Math.max(total, 1);
  for (const heading of headings) {
    heading.at = (marks.get(heading.id) ?? 0) / safe;
    heading.words = wordsAt.find(({ id }) => id === heading.id)?.at ?? 0;
  }
  for (const segment of segments) {
    if (segment.kind === "example") {
      segment.at /= safe;
    }
  }
}
