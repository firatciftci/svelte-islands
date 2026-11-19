import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CSR = /export\s+const\s+csr\s*(?::\s*\w+\s*)?=\s*([^;\n]+)/u;
const UNIVERSAL = /^\+(?:page|layout)\.[jt]s$/u;
const SERVER = /^\+(?:page|layout)\.server\.[jt]s$/u;

type Csr = boolean | "unknown" | null;

function csrIn(file: string): Csr {
  const found = CSR.exec(readFileSync(file, "utf8"))?.[1]?.trim();
  if (found == null) {
    return null;
  }
  if (found === "true" || found === "false") {
    return found === "true";
  }
  return "unknown";
}

function nodeCsr(
  dir: string,
  files: ReadonlyArray<string>,
  kind: "page" | "layout",
) {
  const pick = (pattern: RegExp) =>
    files.find((file) => pattern.test(file) && file.startsWith(`+${kind}`));
  const universal = pick(UNIVERSAL);
  const fromUniversal =
    universal == null ? null : csrIn(path.join(dir, universal));
  if (fromUniversal != null) {
    return fromUniversal;
  }
  const server = pick(SERVER);
  return server == null ? null : csrIn(path.join(dir, server));
}

/**
 * Reads `csr` from each route's `+page` and `+layout` files, the way SvelteKit
 * resolves it: a universal file wins over a server file, and the deepest node
 * that sets it wins. A route maps to `null` when its value isn't a literal, or
 * when it uses a layout reset (`@`), so the caller falls back to the HTML.
 *
 * @param routes The routes directory.
 * @returns Each route id with whether SvelteKit's client runs on it.
 */
export function csrRoutes(routes: string) {
  const found: Record<string, boolean | null> = {};
  const visit = (dir: string, id: string, inherited: Csr) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const layout = nodeCsr(dir, files, "layout");
    const here = layout ?? inherited;
    const isReset = files.some(
      (file) => file.startsWith("+") && file.includes("@"),
    );
    if (
      files.some((file) => /^\+page(?:@[^.]*)?\.(?:svelte|[jt]s)$/u.test(file))
    ) {
      const page = nodeCsr(dir, files, "page") ?? here;
      found[id] = isReset || page === "unknown" ? null : (page ?? true);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        visit(
          path.join(dir, entry.name),
          id === "/" ? `/${entry.name}` : `${id}/${entry.name}`,
          here,
        );
      }
    }
  };
  visit(routes, "/", null);
  return found;
}
