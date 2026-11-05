type Branch = {
  tag: string;
  attributes: Array<[string, string]>;
  children: Iterable<Twig>;
  isFilled: boolean;
};

type Twig = Branch | string;

const TOKEN =
  /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</gu;

const ATTRIBUTE =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const DROPPED = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "title",
  "meta",
  "link",
]);

const MEDIA = new Set(["svg", "canvas", "math", "video", "iframe", "picture"]);

const CONTROLS = new Set(["button", "input", "select", "textarea"]);

const KEPT = new Set([
  "class",
  "style",
  "width",
  "height",
  "viewbox",
  "colspan",
  "rowspan",
  "open",
  "type",
  "size",
  "cols",
  "rows",
]);

const PAINT = /color|background|fill|stroke|shadow|outline|border-image/u;

const PAINTED =
  /#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch|color-mix)\(|var\(--(?:party|color|tint|swatch|hue)/iu;

const OPAQUE = /url\([^)]*\)|"[^"]*"|'[^']*'/giu;

const OPAQUE_MARK = "\0";

const LIMITS = [12, 6, 3, 1];

const HEADING = /^h[1-6]$/u;

const ANY_HEADING = /<h[1-6][\s>]/iu;

const LANDMARKS = new Set(["section", "nav", "aside", "form", "search"]);

const LANDMARK_ROLES = new Set([
  "region",
  "navigation",
  "complementary",
  "search",
  "form",
]);

const OUTLINE = "island-outline";

const OUTLINE_LIMIT = 32;

const BUDGET = 12 * 1024;

const SHOWN = "svg, canvas, math, video, iframe, picture, img";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

function decode(text: string) {
  return text.replaceAll(
    /&(amp|lt|gt|quot|#39|nbsp);/gu,
    (_, name: string) => ENTITIES[name] ?? "",
  );
}

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function attributes(source: string) {
  const found: Array<[string, string]> = [];
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name != null) {
      found.push([name, decode(match[2] ?? match[3] ?? match[4] ?? "")]);
    }
  }
  return found;
}

type Parsed = {
  tag: string;
  attributes: Array<[string, string]>;
  children: Array<Parsed | string>;
  isFilled: boolean;
};

function hasContent(node: Parsed): boolean {
  let isFilled = MEDIA.has(node.tag) || node.tag === "img";
  for (const child of node.children) {
    const isShown =
      typeof child === "string" ? child.trim() !== "" : hasContent(child);
    isFilled ||= isShown;
  }
  node.isFilled = isFilled;
  return isFilled;
}

function parse(html: string) {
  const root: Parsed = {
    tag: "",
    attributes: [],
    children: [],
    isFilled: true,
  };
  const stack: Array<typeof root> = [root];
  for (const match of html.matchAll(TOKEN)) {
    const [token, closing, opening, rest, selfClosing] = match;
    if (token.startsWith("<!--")) {
      continue;
    }
    const parent = stack.at(-1) ?? root;
    if (closing != null) {
      const tag = closing.toLowerCase();
      const at = stack.findLastIndex((open) => open.tag === tag);
      if (at > 0) {
        stack.length = at;
      }
      continue;
    }
    if (opening != null) {
      const element: Parsed = {
        tag: opening.toLowerCase(),
        attributes: attributes(rest ?? ""),
        children: [],
        isFilled: false,
      };
      parent.children.push(element);
      if (selfClosing !== "/" && !VOID.has(element.tag)) {
        stack.push(element);
      }
      continue;
    }
    parent.children.push(decode(token));
  }
  hasContent(root);
  return root;
}

function restyle(style: string) {
  return style
    .replaceAll(OPAQUE, () => OPAQUE_MARK)
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const at = declaration.indexOf(":");
      if (at <= 0 || declaration.includes(OPAQUE_MARK)) {
        return false;
      }
      const property = declaration.slice(0, at).trim().toLowerCase();
      const value = declaration.slice(at + 1);
      return property.startsWith("--")
        ? !PAINTED.test(value)
        : !PAINT.test(property);
    })
    .join(";");
}

function aspect(element: Branch) {
  const box = read(element, "viewbox")
    ?.trim()
    .split(/[\s,]+/u);
  const width = Number(box?.[2] ?? read(element, "width"));
  const height = Number(box?.[3] ?? read(element, "height"));
  return width > 0 && height > 0 ? `aspect-ratio:${width}/${height}` : null;
}

function open(element: Branch, tag: string, extra: Array<string> = []) {
  const parts = [tag];
  const styles: Array<string> = [];
  const classes = [...extra];
  for (const [name, value] of element.attributes) {
    if (!KEPT.has(name)) {
      continue;
    }
    if (name === "class") {
      classes.unshift(value);
    } else if (name === "style") {
      styles.push(restyle(value));
    } else {
      parts.push(value === "" ? name : `${name}="${escape(value)}"`);
    }
  }
  if (classes.length > 0) {
    parts.push(`class="${escape(classes.join(" ").trim())}"`);
  }
  const style = styles.filter((entry) => entry !== "").join(";");
  if (style !== "") {
    parts.push(`style="${escape(style)}"`);
  }
  if (CONTROLS.has(tag)) {
    parts.push("disabled", 'tabindex="-1"');
  }
  return `<${parts.join(" ")}>`;
}

function text(node: string, out: Array<string>) {
  const spaced = node.replaceAll(/\s+/gu, " ");
  const trimmed = spaced.trim();
  if (trimmed === "") {
    if (spaced !== "") {
      out.push(" ");
    }
    return;
  }
  out.push(
    `${spaced.startsWith(" ") ? " " : ""}<span class="island-bone" style="--n:${Math.min(trimmed.length, 48)}"></span>${spaced.endsWith(" ") ? " " : ""}`,
  );
}

function media(node: Branch) {
  if (node.tag === "img") {
    return `${open(node, "span", ["island-media"])}</span>`;
  }
  const ratio = aspect(node);
  const styles = node.attributes
    .filter(([name]) => name === "style")
    .map(([, value]) => value);
  const element: Branch = {
    ...node,
    attributes: [
      ...node.attributes.filter(([name]) => name !== "style"),
      ["style", [...styles, ratio ?? ""].join(";")],
    ],
  };
  return node.tag === "svg" || node.tag === "canvas"
    ? `${open(element, node.tag, ["island-media"])}</${node.tag}>`
    : `${open(element, "span", ["island-media"])}</span>`;
}

function read(element: Branch, name: string) {
  return element.attributes.find(([key]) => key === name)?.[1];
}

function isOutline(element: Branch) {
  return read(element, "class")?.split(/\s+/u).includes(OUTLINE) === true;
}

function emit(node: Twig, limit: number, out: Array<string>) {
  if (typeof node === "string") {
    text(node, out);
    return;
  }
  if (DROPPED.has(node.tag) || isOutline(node)) {
    return;
  }
  if (MEDIA.has(node.tag) || node.tag === "img") {
    out.push(media(node));
    return;
  }
  const isLink = node.tag === "a";
  const tag = isLink ? "span" : node.tag;
  out.push(open(node, tag, isLink ? ["island-link"] : []));
  if (VOID.has(node.tag)) {
    return;
  }
  if (!node.isFilled) {
    out.push(`</${tag}>`);
    return;
  }
  const seen = new Map<string, number>();
  let isSkipping = false;
  for (const child of node.children) {
    if (typeof child === "string") {
      if (!isSkipping) {
        text(child, out);
      }
      continue;
    }
    const signature = `${child.tag} ${child.attributes.find(([name]) => name === "class")?.[1] ?? ""}`;
    const count = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, count);
    isSkipping = count > limit;
    if (!isSkipping) {
      emit(child, limit, out);
    }
  }
  out.push(`</${tag}>`);
}

function grow(element: Element): Branch {
  return {
    tag: element.localName,
    attributes: Array.from(element.attributes, ({ name, value }) => [
      name.toLowerCase(),
      value,
    ]),
    children: twigs(element),
    isFilled:
      element.textContent.trim() !== "" || element.querySelector(SHOWN) != null,
  };
}

function twigs(element: Element): Iterable<Twig> {
  return {
    *[Symbol.iterator]() {
      for (const node of element.childNodes) {
        if (node instanceof Element) {
          yield grow(node);
        } else if (node.nodeType === 3) {
          yield node.nodeValue ?? "";
        }
      }
    },
  };
}

function trim(children: Iterable<Twig>) {
  let shaped = "";
  for (const limit of LIMITS) {
    const out: Array<string> = [];
    for (const child of children) {
      emit(child, limit, out);
    }
    shaped = out.join("").trim();
    if (shaped.length <= BUDGET) {
      return shaped;
    }
  }
  return shaped.length <= BUDGET * 2 ? shaped : null;
}

export function skeletonize(html: string) {
  return trim(parse(html).children);
}

function isConcealed(node: Parsed) {
  return (
    DROPPED.has(node.tag) ||
    read(node, "aria-hidden") === "true" ||
    read(node, "hidden") != null
  );
}

function spoken(node: Parsed | string): string {
  if (typeof node === "string") {
    return node;
  }
  return isConcealed(node)
    ? ""
    : node.children.map((child) => spoken(child)).join("");
}

function tidy(words: string) {
  return words.replaceAll(/\s+/gu, " ").trim();
}

function indexed(node: Parsed, found: Map<string, Parsed>) {
  const id = read(node, "id");
  if (id != null) {
    found.set(id, node);
  }
  for (const child of node.children) {
    if (typeof child !== "string") {
      indexed(child, found);
    }
  }
  return found;
}

function landmark(node: Parsed, ids: Map<string, Parsed>) {
  const role = read(node, "role");
  if (role == null ? !LANDMARKS.has(node.tag) : !LANDMARK_ROLES.has(role)) {
    return null;
  }
  const named =
    read(node, "aria-label") ??
    read(node, "aria-labelledby")
      ?.trim()
      .split(/\s+/u)
      .map((id) => {
        const target = ids.get(id);
        return target == null ? "" : spoken(target);
      })
      .join(" ");
  const label = named == null ? "" : tidy(named);
  if (label === "") {
    return null;
  }
  return { label, role };
}

function heading(node: Parsed) {
  const name = tidy(read(node, "aria-label") ?? spoken(node));
  if (name === "") {
    return null;
  }
  const id = read(node, "id");
  const anchor = id == null ? "" : ` id="${escape(id)}"`;
  return `<${node.tag}${anchor}>${escape(name)}</${node.tag}>`;
}

function place(
  node: Parsed,
  ids: Map<string, Parsed>,
  room: { left: number },
  out: Array<string>,
) {
  if (HEADING.test(node.tag)) {
    const made = heading(node);
    if (made != null) {
      room.left -= 1;
      out.push(made);
    }
    return;
  }
  const found = landmark(node, ids);
  const inner = found == null ? out : [];
  walk(node, ids, room, inner);
  if (found != null && inner.length > 0) {
    const role = found.role == null ? "" : ` role="${escape(found.role)}"`;
    out.push(
      `<${node.tag}${role} aria-label="${escape(found.label)}">`,
      ...inner,
      `</${node.tag}>`,
    );
  }
}

function walk(
  node: Parsed,
  ids: Map<string, Parsed>,
  room: { left: number },
  out: Array<string>,
) {
  for (const child of node.children) {
    if (room.left === 0) {
      return;
    }
    if (typeof child !== "string" && !isConcealed(child)) {
      place(child, ids, room, out);
    }
  }
}

export function outline(html: string) {
  if (!ANY_HEADING.test(html)) {
    return "";
  }
  const root = parse(html);
  const out: Array<string> = [];
  walk(root, indexed(root, new Map()), { left: OUTLINE_LIMIT }, out);
  return out.length === 0
    ? ""
    : `<div class="${OUTLINE}">${out.join("")}</div>`;
}

export function shape(element: Element) {
  return trim(twigs(element));
}
