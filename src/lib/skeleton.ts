type Branch = {
  tag: string;
  attributes: Array<[string, string]>;
  children: Iterable<Twig>;
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

const LIMITS = [12, 6, 3];

const BUDGET = 48 * 1024;

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

function parse(html: string) {
  const root = {
    tag: "",
    attributes: new Array<[string, string]>(),
    children: new Array<Twig>(),
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
      const element = {
        tag: opening.toLowerCase(),
        attributes: attributes(rest ?? ""),
        children: new Array<Twig>(),
      };
      parent.children.push(element);
      if (selfClosing !== "/" && !VOID.has(element.tag)) {
        stack.push(element);
      }
      continue;
    }
    parent.children.push(decode(token));
  }
  return root;
}

function restyle(style: string) {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const at = declaration.indexOf(":");
      if (at <= 0) {
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
  const read = (name: string) =>
    element.attributes.find(([key]) => key === name)?.[1];
  const box = read("viewbox")
    ?.trim()
    .split(/[\s,]+/u);
  const width = Number(box?.[2] ?? read("width"));
  const height = Number(box?.[3] ?? read("height"));
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

function emit(node: Twig, limit: number, out: Array<string>) {
  if (typeof node === "string") {
    text(node, out);
    return;
  }
  if (DROPPED.has(node.tag)) {
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
  let elements = 0;
  for (const child of node.children) {
    if (typeof child !== "string") {
      elements++;
    }
    if (elements > limit) {
      break;
    }
    emit(child, limit, out);
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

export function shape(element: Element) {
  return trim(twigs(element));
}
