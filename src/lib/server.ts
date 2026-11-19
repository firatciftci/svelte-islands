import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { building, dev } from "$app/env";
import { asset } from "$app/paths";
import { getRequestEvent } from "$app/server";
import { createHash, randomUUID } from "node:crypto";
import { render } from "svelte/server";
import type { Adopted, Fetch, Fresh, Island, Scope, Shell } from "./part.js";
import type { RebuildOptions } from "./rebuild.js";
import type { Store } from "./stores.js";
import Frame from "./frame.svelte";
import { isPackable, pack, plainKey } from "./pack.js";
import { coded } from "./errors.js";
import {
  Part,
  provide,
  quietly,
  serialize,
  settings,
  transportClaims,
  usePacker,
} from "./part.js";
import { gate, REBUILD_DEFAULTS, rebuilds } from "./rebuild.js";
import { fallback, needsOf, reading } from "./runtime.js";
import { outline, skeletonize } from "./skeleton.js";
import { startTracing, traced, tracedAsync } from "./trace.js";

class Packed {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

const packedTexts = new WeakMap<Part, string>();

const isListed = (value: unknown) => Array.isArray(value) && value.length >= 4;

usePacker(
  (value, claims, isNested) => {
    if (value instanceof Packed) {
      return value.text;
    }
    if (isNested && !isListed(value)) {
      return null;
    }
    return isPackable(value, claims) ? JSON.stringify(pack(value)) : null;
  },
  (made, value) => {
    const text = packedTexts.get(made);
    return text != null && isListed(value) ? new Packed(text) : value;
  },
);

export type { RebuildOptions } from "./rebuild.js";
export type { Store } from "./stores.js";

const TOKEN = "x-svelte-islands-token";
const FRESH = "x-svelte-islands-fresh";
const PRIVATE = "private, no-store";
const SHAPES = "skeletons.json";
const NAMES = "skeleton-names";
const FILE = /^[\w-]{22}(?:\.json|\.html)?$/u;
const RELEARN = 10 * 60_000;
const OUTLINES = 4096;
const HOLLOW = 3;
const IMMUTABLE = "public, max-age=31536000, immutable";
const MIN_COMPRESSED = 1024;
const SETTLE = 1000;
const BOOT = "__svelte_islands_boot__";
const NATIVE = /__sveltekit_\w+\s*=\s*\{/u;

declare const __SVELTE_ISLANDS_CSR__:
  | Record<string, boolean | null>
  | undefined;

function csrOf(id: string | null) {
  const routes =
    (globalThis as { __svelteIslandsCsr?: Record<string, boolean | null> })
      .__svelteIslandsCsr ??
    (typeof __SVELTE_ISLANDS_CSR__ === "undefined"
      ? null
      : __SVELTE_ISLANDS_CSR__);
  return id == null ? null : (routes?.[id] ?? null);
}

function isShellPage(html: string, event: RequestEvent) {
  const isNative = NATIVE.test(html);
  const csr = csrOf(event.route.id);
  if (csr == null) {
    return !isNative;
  }
  if (dev && csr !== isNative) {
    warnOnce(`csr:${event.route.id ?? ""}`, () => {
      console.warn(
        coded(
          "islands_csr_mismatch",
          `The route ${event.route.id ?? ""} sets csr = ${String(csr)}, but its HTML says otherwise. Islands follow csr = ${String(csr)}. If you changed SvelteKit, please report this.`,
        ),
      );
    });
  }
  return !csr;
}
const VIEW_TRANSITIONS = "<style>@view-transition{navigation:auto}</style>";

type Digest = { text: string; hash: string };

const DIGESTS_LIMIT = 4 * 1024 * 1024;

const byContent = new Map<string, Digest>();
const recent = new Map<string, string>();
const exemplars = new Map<string, Map<string, { html: string; at: number }>>();
const asked = new Set<string>();
const waiting = new Map<string, Map<string, Digest>>();
const gathering = new Map<string, Array<Fresh>>();
const requests = new WeakMap<
  object,
  {
    parts: Set<Part>;
    files: Set<string>;
    early: Set<string>;
    shells: Array<Shell>;
    islands: number;
    isHeaded: boolean;
    isPersonal: boolean;
    isStreamed: boolean;
    writes: Array<Promise<unknown>>;
  }
>();
const warned = new Set<string>();
const WARNINGS = 256;
const PAGES = 4096;
const freshPages = new Set<string>();
const barren = new Map<string, number>();
const squeezed = new Map<
  string,
  { size: number; work: Promise<Uint8Array<ArrayBuffer> | null> }
>();
const outlines = new Map<string, string>();
const hollow = new Map<string, { count: number; at: number }>();
type Speculation = "prefetch" | "prerender" | false;
type Prepare = (
  request: { url: URL; headers: Headers },
  event: RequestEvent,
) => void;

const config: {
  store: Store | null;
  memory: number;
  prepare: Prepare;
  vary: (event: RequestEvent) => string;
  rebuild: Required<RebuildOptions> | null;
  compress: boolean;
  warnOnCookies: boolean;
  shareStreamed: boolean;
  speculation: Speculation;
  viewTransitions: boolean;
} = {
  store: null,
  memory: 64 * 1024 ** 2,
  prepare: () => {},
  vary: () => "",
  rebuild: REBUILD_DEFAULTS,
  compress: true,
  warnOnCookies: true,
  shareStreamed: false,
  speculation: false,
  viewTransitions: false,
};
const state: {
  held: number;
  remembered: number;
  squeezed: number;
  names: Promise<unknown> | null;
} = { held: 0, remembered: 0, squeezed: 0, names: null };
const limits = () => config.rebuild ?? REBUILD_DEFAULTS;
const rebuild = rebuilds<Map<string, Digest>>(limits);
const freshTurns = gate(limits);

function bound(
  kept: {
    size: number;
    keys: () => Iterable<string>;
    delete: (key: string) => boolean;
  },
  most: number,
) {
  for (const oldest of kept.keys()) {
    if (kept.size <= most) {
      break;
    }
    kept.delete(oldest);
  }
}

function hashOf(text: string) {
  return createHash("sha256").update(text).digest("base64url").slice(0, 22);
}

function digest(value: unknown, isPrivate: boolean) {
  if (isPrivate) {
    return digested(serialize(value, true));
  }
  const key = plainKey(value, transportClaims());
  const found = key == null ? null : (byContent.get(key) ?? null);
  if (key == null || found == null) {
    const made = digested(serialize(value));
    if (key != null) {
      remember(key, made);
    }
    return made;
  }
  remember(key, found);
  return found;
}

function digested(text: string) {
  return { text, hash: hashOf(text) };
}

function remember(key: string, made: Digest) {
  if (byContent.delete(key)) {
    byContent.set(key, made);
    return;
  }
  byContent.set(key, made);
  state.remembered += key.length + made.text.length;
  for (const [oldest, kept] of byContent) {
    if (state.remembered <= DIGESTS_LIMIT) {
      break;
    }
    byContent.delete(oldest);
    state.remembered -= oldest.length + kept.text.length;
  }
}

function hold({ hash, text }: Digest) {
  const known = recent.get(hash);
  if (known != null) {
    recent.delete(hash);
    recent.set(hash, known);
    return false;
  }
  recent.set(hash, text);
  state.held += text.length;
  for (const [oldest, kept] of recent) {
    if (building || state.held <= config.memory) {
      break;
    }
    recent.delete(oldest);
    state.held -= kept.length;
  }
  return true;
}

function write(key: string, text: string, event: RequestEvent | null) {
  const work = quietly(config.store?.set(key, text));
  if (event != null && config.store != null) {
    track(event.locals).writes.push(work);
  }
}

function publish(made: Digest, event: RequestEvent) {
  if (hold(made)) {
    write(`p:${made.hash}`, made.text, event);
  }
}

function keep(made: Digest, event: RequestEvent) {
  const rerunning = waiting.get(event.request.headers.get(TOKEN) ?? "");
  if (rerunning == null) {
    publish(made, event);
  } else {
    rerunning.set(made.hash, made);
  }
}

function track(locals: object) {
  let found = requests.get(locals);
  if (found == null) {
    found = {
      parts: new Set(),
      files: new Set(),
      early: new Set(),
      shells: [],
      islands: 0,
      isHeaded: false,
      isPersonal: false,
      isStreamed: false,
      writes: [],
    };
    requests.set(locals, found);
  }
  return found;
}

function warnOnce(key: string, log: () => void) {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  bound(warned, WARNINGS);
  log();
}

function flatten(known: Map<string, { html: string }>) {
  return Object.fromEntries(
    known.entries().map(([key, { html }]) => [key, html]),
  );
}

function examplesOf(name: string) {
  let known = exemplars.get(name);
  if (known == null) {
    known = new Map();
    exemplars.set(name, known);
  }
  return known;
}

function attempt(html: () => string | null) {
  try {
    const rendered = html();
    return rendered == null || rendered.includes("island-fallback")
      ? null
      : skeletonize(rendered);
  } catch {
    return null;
  }
}

function outlined(identity: string, html: () => string | null, view?: string) {
  const found = outlines.get(identity);
  if (found != null) {
    return found;
  }
  const seen = view == null ? null : hollow.get(view);
  if (seen != null && seen.count >= HOLLOW && Date.now() - seen.at < RELEARN) {
    return "";
  }
  let made = "";
  try {
    made = outline(html() ?? "");
  } catch {
    made = "";
  }
  if (view != null) {
    if (made === "") {
      hollow.set(view, { count: (seen?.count ?? 0) + 1, at: Date.now() });
    } else {
      hollow.delete(view);
    }
  }
  if (outlines.size >= OUTLINES) {
    const oldest = outlines.keys().next();
    if (!oldest.done) {
      outlines.delete(oldest.value);
    }
  }
  outlines.set(identity, made);
  return made;
}

async function recallAll() {
  const { store } = config;
  if (store == null) {
    return;
  }
  const recallNames = async () => {
    const text = await store.get(NAMES);
    const parsed: unknown = text == null ? null : JSON.parse(text);
    await Promise.all(
      (Array.isArray(parsed) ? parsed : []).flatMap((name: unknown) =>
        typeof name === "string" ? [recall(name)] : [],
      ),
    );
  };
  state.names ??= quietly(recallNames());
  await state.names;
}

async function index() {
  await recallAll();
  await config.store?.set(NAMES, JSON.stringify(exemplars.keys().toArray()));
}

function current() {
  try {
    return getRequestEvent();
  } catch {
    return null;
  }
}

function learn(name: string, key: string, html: () => string | null) {
  const known = examplesOf(name);
  const found = known.get(key);
  if (found != null && Date.now() - found.at < RELEARN) {
    return found.html;
  }
  const shaped = attempt(html);
  if (shaped == null || shaped === "") {
    return found?.html ?? null;
  }
  const isNew = known.size === 0;
  known.set(key, { html: shaped, at: Date.now() });
  if (found?.html !== shaped) {
    write(`skeletons:${name}`, JSON.stringify(flatten(known)), current());
  }
  if (isNew) {
    void quietly(index());
  }
  return shaped;
}

async function recall(name: string) {
  const { store } = config;
  if (store == null || asked.has(name)) {
    return;
  }
  asked.add(name);
  try {
    const text = await store.get(`skeletons:${name}`);
    const parsed: unknown = text == null ? null : JSON.parse(text);
    if (typeof parsed !== "object" || parsed == null) {
      return;
    }
    const known = examplesOf(name);
    for (const [key, html] of Object.entries(parsed)) {
      if (typeof html === "string" && !known.has(key)) {
        known.set(key, { html, at: 0 });
      }
    }
  } catch {
    asked.delete(name);
  }
}

function warnPersonal(name: string, found: { isPersonal: boolean }) {
  if (!dev || !config.warnOnCookies || !found.isPersonal) {
    return;
  }
  warnOnce(name, () =>
    console.warn(
      coded(
        "islands_part_after_cookies",
        `part("${name}") was made during a request that read cookies. Parts are served from a public, immutable URL. If this value differs per visitor, pass { private: true }. If it doesn't, pass warnOnCookies: false to handle().`,
      ),
    ),
  );
}

/**
 * Wraps a value from a server `load` so it travels outside the page's data.
 *
 * Parts over the `inline` limit are stored under a hash of their contents and
 * served from a public, immutable URL. Pass `private: true` for anything that
 * differs per visitor: a private part is never stored and always stays in the
 * page's data.
 *
 * @param name A stable name for this kind of data. Skeletons are learned per name.
 * @param value The value to send. Plain data travels in a compact packed form.
 * @param options When the part loads and who may see it.
 */
export function part<T>(
  name: string,
  value: T,
  {
    fetch = "auto",
    private: isAskedPrivate = false,
  }: {
    /** When the browser requests the part: `"auto"`, `"lazy"`, or `"preload"`. */
    fetch?: Fetch;
    /** Keeps the part out of the store and off public URLs. */
    private?: boolean;
  } = {},
): Part<T> {
  const event = getRequestEvent();
  const isPrivate = isAskedPrivate || gatheredBy(event) != null;
  const made = traced(
    event,
    "part.serialize",
    { "svelte-islands.part.serialize.name": name },
    (span) => {
      const found = digest(value, isPrivate);
      span?.setAttribute(
        "svelte-islands.part.serialize.bytes",
        found.text.length,
      );
      return found;
    },
  );
  const found = track(event.locals);
  if (!isPrivate) {
    warnPersonal(name, found);
    keep(made, event);
  }
  const created = new Part<T>({
    name,
    hash: made.hash,
    source: event.url.pathname,
    bytes: made.text.length,
    fetch,
    isEager: fetch === "preload" || (fetch === "auto" && event.isDataRequest),
    isPrivate,
    loaded: { value },
  });
  if (made.text.startsWith("~")) {
    packedTexts.set(created, made.text.slice(1));
  }
  found.parts.add(created);
  return created;
}

/**
 * Makes the part for an island with `render="fresh"`, so the page itself stays
 * the same for every visitor and can be cached.
 *
 * While the page renders, the part holds `fallback`, and `read` doesn't run.
 * When the browser asks for the page's fresh islands, `read` runs with that
 * visitor's request, and the part it makes is private.
 *
 * @param name A stable name for this kind of data.
 * @param read Reads the value for the visitor, for example from their cookies.
 * @param fallback The value for everyone else, such as an empty cart.
 */
export async function fresh<T>(
  name: string,
  read: () => T | Promise<T>,
  fallback: T,
): Promise<Part<T>> {
  return gatheredBy(getRequestEvent()) == null
    ? part(name, fallback)
    : part(name, await read(), { private: true });
}

function shellHtml(skeleton: string | null, bytes: number) {
  return `<div class="island-shell" aria-hidden="true">${skeleton ?? fallback(bytes)}</div>`;
}

function attribute(name: string, value: string | number | null) {
  return value == null
    ? ""
    : ` ${name}="${String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`;
}

function wrap(island: Island, made: Omit<Adopted, "html">, inner: string) {
  const { part: origin, as } = island;
  const attributes = [
    attribute(
      "class",
      island.className == null ? "island" : `island ${island.className}`,
    ),
    attribute("data-island", origin.hash),
    attribute("data-island-name", dev ? origin.name : null),
    attribute("data-island-module", island.module),
    attribute("data-island-why", dev ? island.why : null),
    attribute("data-island-bytes", dev ? origin.bytes : null),
    attribute("data-island-state", made.state),
    attribute("data-island-file", made.file),
    attribute("data-island-needs", made.needs),
    attribute("aria-busy", made.isBusy ? "true" : null),
  ].join("");
  return `<${as}${attributes}>${inner}</${as}>`;
}

function adopt(
  event: RequestEvent,
  scope: Scope,
  island: Island,
): Adopted | null {
  const { part: origin, key, render: mode, as, module } = island;
  track(event.locals).islands++;
  const isDeferred = mode === "deferred" && !origin.isPrivate;
  const isFresh = mode === "fresh";
  const ssr = mode !== "client";
  if (as === "tbody" && mode !== "server") {
    throw new Error(
      coded(
        "islands_tbody_needs_server",
        `The island for part("${origin.name}") uses as="tbody", which needs its rows in the page. Use render="server".`,
      ),
    );
  }
  const { loaded } = origin;
  if (
    loaded == null ||
    (origin.isInline && ssr && !isDeferred && !isFresh && module == null)
  ) {
    return null;
  }
  const prefix = `s${origin.hash.slice(0, 6).replaceAll("-", "_")}`;
  let drawn: { result: string; reads: Set<Part> } | null = null;
  const draw = () =>
    (drawn ??= reading(() =>
      scope.render(island.body, loaded.value, island.context, prefix),
    ));
  const isSecret = () =>
    origin.isPrivate ||
    draw()
      .reads.values()
      .some((read) => read.isPrivate);
  const html = () => (isSecret() ? null : draw().result);
  const shell = () =>
    shellHtml(scope.skeleton(origin.name, key, html), origin.bytes);
  const made = ((): Adopted => {
    if (isFresh) {
      const collect = collector(event);
      if (collect != null) {
        try {
          collect({
            key,
            html: draw().result,
            part: origin,
            needs: needsOf(draw().reads, origin),
          });
        } catch (error) {
          if (!awaited(error, origin.name)) {
            throw error;
          }
        }
      }
      return {
        state: "fresh",
        file: null,
        needs: null,
        isBusy: true,
        html: shell(),
      };
    }
    if (!ssr) {
      const outlined = outlineFor(event, `${origin.hash}:${key}`, html, key);
      return {
        state: "client",
        file: null,
        needs: null,
        isBusy: outlined === "",
        html: `${outlined}${shell()}`,
      };
    }
    let rendered: string;
    try {
      rendered = draw().result;
    } catch (error) {
      if (!awaited(error, origin.name)) {
        throw error;
      }
      return {
        state: "client",
        file: null,
        needs: null,
        isBusy: true,
        html: shell(),
      };
    }
    const needs = needsOf(draw().reads, origin);
    if (!isDeferred || isSecret()) {
      return {
        state: "static",
        file: null,
        needs,
        isBusy: false,
        html: rendered,
      };
    }
    const file = stash(event, rendered, island.reveal === "eager");
    const outlined = outlineFor(event, file, html);
    return {
      state: "deferred",
      file,
      needs,
      isBusy: outlined === "",
      html: `${outlined}${shell()}`,
    };
  })();
  if (module != null) {
    track(event.locals).shells.push({
      part: origin,
      key,
      state: made.state,
      file: made.file,
      needs: made.needs,
      module,
      hydrate: island.hydrate,
      reveal: island.reveal,
      margin: island.margin,
      media: island.media,
      prefetch: island.prefetch,
      scope: island.scope,
      context: island.context,
    });
  }
  return { ...made, html: wrap(island, made, made.html) };
}

function stash(event: RequestEvent, html: string, isEarly: boolean) {
  const made = { text: html, hash: `${hashOf(html)}.html` };
  keep(made, event);
  const found = track(event.locals);
  found.files.add(made.hash);
  if (isEarly) {
    found.early.add(made.hash);
  }
  return made.hash;
}

function outlineFor(
  event: RequestEvent,
  identity: string,
  html: () => string | null,
  view?: string,
) {
  return outlined(`${config.vary(event)}:${identity}`, html, view);
}

function awaited(error: unknown, name: string) {
  const code =
    error instanceof Error
      ? "code" in error && typeof error.code === "string"
        ? error.code
        : error.message.split("\n", 1)[0]
      : null;
  const isAwait = code === "await_invalid";
  if (isAwait && dev) {
    console.warn(
      coded(
        "islands_await_while_rendering",
        `The island for part("${name}") uses await while rendering, so it renders in the browser instead of the server HTML. To keep it in the server HTML, load that data into the part.`,
      ),
    );
  }
  return isAwait;
}

provide(() => {
  const event = current();
  if (event == null) {
    return null;
  }
  const scope: Scope = {
    render: (body, value, context, prefix) =>
      render(Frame, { props: { body, value }, context, idPrefix: prefix }).body,
    skeleton: (name, key, html) => {
      void recall(name);
      return learn(name, key, html);
    },
    shape: (name) => {
      void recall(name);
      return exemplars.get(name)?.get(name)?.html ?? null;
    },
    adopt: (island) => adopt(event, scope, island),
  };
  return scope;
});

function gatheredBy(event: RequestEvent) {
  const token = event.request.headers.get(FRESH);
  return token == null ? null : (gathering.get(token) ?? null);
}

function collector(event: RequestEvent) {
  const found = gatheredBy(event);
  return found == null
    ? null
    : (island: Fresh) => {
        found.push(island);
      };
}

function preloads({ parts }: { parts: Set<Part> }) {
  return parts
    .values()
    .filter((created) => created.fetch === "preload" && !created.isInline)
    .map(
      (created) =>
        `<link rel="preload" href="${settings.prefix}${created.hash}.json" as="fetch" crossorigin="anonymous">`,
    );
}

function crawlable({ parts, files }: { parts: Set<Part>; files: Set<string> }) {
  const published = new Set([
    SHAPES,
    ...files,
    ...parts
      .values()
      .filter((created) => !created.isInline)
      .map((created) => `${created.hash}.json`),
  ]);
  return published
    .values()
    .map(
      (file) => `<link rel="svelte-islands" href="${settings.prefix}${file}">`,
    );
}

const SWAP = `((prefix, files) => {
  const shared = (globalThis.__svelteIslands ??= {});
  const early = (shared.early ??= new Map());
  const swap = (file, html) => {
    const target = shared.isClaiming
      ? null
      : document.querySelector(\`[data-island-file="\${file}"][data-island-state="deferred"]\`);
    const shell = target?.querySelector(":scope > .island-shell");
    if (shell == null) {
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    target.querySelector(":scope > .island-outline")?.remove();
    shell.replaceWith(template.content);
    target.dataset.islandState = "static";
    target.removeAttribute("aria-busy");
    early.delete(file);
  };
  for (const file of files) {
    early.set(
      file,
      fetch(prefix + file).then(
        async (response) => {
          const html = response.ok ? await response.text() : null;
          if (html != null && document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => swap(file, html), { once: true });
          } else if (html != null) {
            swap(file, html);
          }
          return html;
        },
        () => null,
      ),
    );
  }
})`;

function swapped(early: Set<string>) {
  return early.size === 0
    ? []
    : [
        `<script>${SWAP}(${JSON.stringify([settings.prefix, [...early]])
          .slice(1, -1)
          .replaceAll("<", String.raw`\u003c`)})</script>`,
      ];
}

function urlOf(file: string) {
  return asset(file as Parameters<typeof asset>[0]);
}

function bootFiles(): Array<string> | null {
  return BOOT.startsWith("[") ? (JSON.parse(BOOT) as Array<string>) : null;
}

function rulesFor(mode: "prefetch" | "prerender") {
  const rules = {
    [mode]: [
      {
        source: "document",
        where: {
          and: [
            { href_matches: "/*" },
            {
              not: {
                selector_matches:
                  "[download], [rel~='external'], [data-sveltekit-preload-data='false'], [data-sveltekit-preload-data='false'] a",
              },
            },
          ],
        },
        eagerness: "moderate",
      },
    ],
  };
  return `<script type="speculationrules">${JSON.stringify(rules)}</script>`;
}

type Sent = Omit<Shell, "scope" | "context"> & {
  scope: {
    at: number | null;
    names: Array<string>;
    own: Record<string, unknown>;
  } | null;
  context: Array<[isSymbol: boolean, name: string, value: unknown]>;
};

const SCOPE = Symbol.for("svelte-islands:scope");

function isMarked(
  value: unknown,
): value is { instance: object; own: ReadonlyArray<string> } {
  return (
    typeof value === "object" &&
    value != null &&
    "instance" in value &&
    "own" in value &&
    Array.isArray(value.own)
  );
}

function sendable(value: unknown, checked: Map<unknown, boolean>) {
  const known = checked.get(value);
  if (known != null) {
    return known;
  }
  let isSendable = true;
  try {
    serialize(value, true);
  } catch {
    isSendable = false;
  }
  checked.set(value, isSendable);
  return isSendable;
}

function valuesOf(island: Shell, checked: Map<unknown, boolean>) {
  if (island.scope == null) {
    return null;
  }
  const values: Record<string, unknown> = {};
  for (const name of Object.keys(island.scope)) {
    const value: unknown = Reflect.get(island.scope, name);
    if (!sendable(value, checked)) {
      const held =
        typeof value === "function"
          ? "a function"
          : "a value that can't be serialized";
      throw new Error(
        coded(
          "islands_shell_value",
          `The island for part("${island.part.name}") reads \`${name}\` from the page, and it holds ${held}. On a page with csr = false, an island gets a copy of each page value it reads, so \`${name}\` can't reach it. Define it in a module the island imports, or move it inside the island's snippet.`,
        ),
      );
    }
    values[name] = value;
  }
  return values;
}

const KIT_CONTEXTS = new Set(["__request__", "__svelte__"]);

function nameOf(key: unknown) {
  if (typeof key === "string") {
    return key;
  }
  return typeof key === "symbol" ? Symbol.keyFor(key) : undefined;
}

function contextsOf(island: Shell, checked: Map<unknown, boolean>) {
  const kept: Sent["context"] = [];
  const dropped: Array<string> = [];
  for (const [key, value] of island.context) {
    if (typeof key === "string" && KIT_CONTEXTS.has(key)) {
      continue;
    }
    const name = nameOf(key);
    if (name == null || !sendable(value, checked)) {
      dropped.push(typeof key === "string" ? `"${key}"` : String(key));
      continue;
    }
    kept.push([typeof key === "symbol", name, value]);
  }
  if (dev && dropped.length > 0) {
    warnOnce(`contexts:${dropped.join(", ")}`, () =>
      console.warn(
        coded(
          "islands_shell_context",
          `On a page with csr = false, an island only gets contexts whose keys are strings or Symbol.for() keys and whose values can be serialized, so the island for part("${island.part.name}") won't get ${dropped.join(", ")}. Use context() from svelte-islands for a key that reaches it.`,
        ),
      ),
    );
  }
  return kept;
}

function shellOf(shells: ReadonlyArray<Shell>) {
  const files = bootFiles();
  if (files == null || files.length === 0 || shells.length === 0) {
    return null;
  }
  const checked = new Map<unknown, boolean>();
  const islands: Array<Sent> = [];
  const instances = new Map<object, number>();
  const scopes: Array<Record<string, unknown>> = [];
  const scopeFor = (
    island: Shell,
    values: Record<string, unknown> | null,
  ): Sent["scope"] => {
    if (values == null) {
      return null;
    }
    const marked =
      island.scope == null ? null : Reflect.get(island.scope, SCOPE);
    const sent: NonNullable<Sent["scope"]> = { at: null, names: [], own: {} };
    let shared: Record<string, unknown> | null = null;
    if (isMarked(marked)) {
      sent.at = instances.get(marked.instance) ?? scopes.length;
      if (sent.at === scopes.length) {
        instances.set(marked.instance, sent.at);
        scopes.push({});
      }
      shared = scopes[sent.at] ?? null;
    }
    for (const [name, value] of Object.entries(values)) {
      if (shared == null || (isMarked(marked) && marked.own.includes(name))) {
        sent.own[name] = value;
      } else {
        shared[name] = value;
        sent.names.push(name);
      }
    }
    return sent;
  };
  for (const island of shells) {
    let values: Record<string, unknown> | null;
    try {
      values = valuesOf(island, checked);
    } catch (error) {
      if (dev || !(error instanceof Error)) {
        throw error;
      }
      const { message } = error;
      warnOnce(message, () => console.error(message));
      continue;
    }
    islands.push({
      ...island,
      scope: scopeFor(island, values),
      context: contextsOf(island, checked),
    });
  }
  if (islands.length === 0) {
    return null;
  }
  const [entry = ""] = files;
  const data = serialize({ scopes, islands }, true).replaceAll(
    "<",
    String.raw`\u003c`,
  );
  return {
    head: files.map(
      (file) => `<link rel="modulepreload" href="${urlOf(file)}">`,
    ),
    body: `<script type="application/json" id="svelte-islands">${data}</script><script type="module" src="${urlOf(entry)}"></script>`,
  };
}

function before(html: string, marker: string, text: string) {
  const at = html.indexOf(marker);
  return at === -1 || text === ""
    ? html
    : `${html.slice(0, at)}${text}${html.slice(at)}`;
}

function inject(html: string, event: RequestEvent) {
  const found = requests.get(event.locals);
  if (found?.isHeaded === true) {
    return html;
  }
  if (found != null) {
    found.isHeaded = true;
  }
  let inline = 0;
  let external = 0;
  for (const sent of found?.parts ?? []) {
    if (sent.isInline) {
      inline += sent.bytes;
    } else {
      external += sent.bytes;
    }
  }
  return traced(
    event,
    "page",
    {
      "svelte-islands.page.islands": found?.islands ?? 0,
      "svelte-islands.page.inline_bytes": inline,
      "svelte-islands.page.external_bytes": external,
    },
    (span) => {
      const isShell = isShellPage(html, event);
      span?.setAttribute("svelte-islands.page.shell", isShell);
      return injected(html, isShell, found);
    },
  );
}

function injected(
  html: string,
  isShell: boolean,
  found: ReturnType<typeof requests.get>,
) {
  const shell = isShell && found != null ? shellOf(found.shells) : null;
  const head = [
    ...(config.viewTransitions ? [VIEW_TRANSITIONS] : []),
    ...(isShell && config.speculation !== false
      ? [rulesFor(config.speculation)]
      : []),
    ...(found == null ? [] : building ? crawlable(found) : preloads(found)),
    ...(found == null ? [] : swapped(found.early)),
    ...(shell?.head ?? []),
  ];
  return before(
    before(html, "</head>", head.join("")),
    "</body>",
    shell?.body ?? "",
  );
}

function pageOf(event: RequestEvent) {
  const source = event.url.searchParams.get("u");
  if (source?.startsWith("/") !== true) {
    return null;
  }
  try {
    const target = new URL(source, event.url.origin);
    return target.origin === event.url.origin &&
      !target.pathname.startsWith(settings.prefix)
      ? target
      : null;
  } catch {
    return null;
  }
}

async function rerun(isMarkup: boolean, target: URL, event: RequestEvent) {
  const token = randomUUID();
  const found = new Map<string, Digest>();
  waiting.set(token, found);
  try {
    const data = isMarkup
      ? target
      : new URL(
          `${target.pathname.replace(/\/$/u, "")}/__data.json${target.search}`,
          event.url.origin,
        );
    const headers = new Headers({ [TOKEN]: token });
    const language = event.request.headers.get("accept-language");
    if (language != null) {
      headers.set("accept-language", language);
    }
    config.prepare({ url: data, headers }, event);
    const response = await event.fetch(data, { headers });
    await response.arrayBuffer();
    const isPersonal = [event.request.headers, headers].some(
      (sent) => sent.has("cookie") || sent.has("authorization"),
    );
    if (!isPersonal) {
      for (const made of found.values()) {
        publish(made, event);
      }
    }
    return found;
  } finally {
    waiting.delete(token);
  }
}

async function recover(file: string, event: RequestEvent) {
  const target = building || config.rebuild == null ? null : pageOf(event);
  if (target == null) {
    return null;
  }
  const isMarkup = file.endsWith(".html");
  const language = event.request.headers.get("accept-language") ?? "";
  const outcome = await tracedAsync(
    event,
    "rebuild",
    {
      "svelte-islands.rebuild.page": target.pathname,
      "svelte-islands.rebuild.queue": rebuild.queued(),
    },
    async (span) => {
      const result = await rebuild(
        [
          isMarkup ? "html" : "data",
          config.vary(event),
          language,
          `${target.pathname}${target.search}`,
        ].join("\n"),
        async () => rerun(isMarkup, target, event),
      );
      span?.setAttribute("svelte-islands.rebuild.outcome", result.status);
      return result;
    },
  );
  if (outcome.status === "busy") {
    throw new Error("busy");
  }
  const made = outcome.status === "ran" ? outcome.found.get(file) : undefined;
  if (made == null) {
    return null;
  }
  publish(made, event);
  return made.text;
}

const ALREADY_ENCODED = { encodeBody: "manual" } as const;

async function brotli(text: string) {
  try {
    const { brotliCompress, constants } = await import("node:zlib");
    return await new Promise<Uint8Array<ArrayBuffer> | null>((resolve) => {
      brotliCompress(
        text,
        {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: text.length > 1024 ** 2 ? 5 : 9,
            [constants.BROTLI_PARAM_SIZE_HINT]: text.length,
          },
        },
        (error, result) => {
          resolve(error == null ? new Uint8Array(result) : null);
        },
      );
    });
  } catch {
    return null;
  }
}

async function squeeze(file: string, text: string) {
  const known = squeezed.get(file);
  if (known != null) {
    return known.work;
  }
  const entry = { size: 0, work: brotli(text) };
  squeezed.set(file, entry);
  const result = await entry.work;
  if (result == null) {
    squeezed.delete(file);
    return null;
  }
  entry.size = result.length;
  state.squeezed += result.length;
  for (const [oldest, { size }] of squeezed) {
    if (state.squeezed <= config.memory / 4) {
      break;
    }
    squeezed.delete(oldest);
    state.squeezed -= size;
  }
  return result;
}

async function encoded(file: string, text: string, event: RequestEvent) {
  const accepts = event.request.headers.get("accept-encoding") ?? "";
  return config.compress &&
    text.length >= MIN_COMPRESSED &&
    /\bbr\b/u.test(accepts)
    ? squeeze(file, text)
    : null;
}

async function shapes(event: RequestEvent) {
  await recallAll();
  const all: Record<string, string> = {};
  for (const known of exemplars.values()) {
    Object.assign(all, flatten(known));
  }
  const text = JSON.stringify(all);
  const hash = hashOf(text);
  const compressed = await encoded(`${SHAPES}:${hash}`, text, event);
  return new Response(compressed ?? text, {
    ...ALREADY_ENCODED,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=600, stale-while-revalidate=86400",
      vary: "accept-encoding",
      etag: compressed == null ? `"${hash}"` : `"${hash}-br"`,
      ...(compressed != null && { "content-encoding": "br" }),
    },
  });
}

async function gatherFresh(target: URL, event: RequestEvent) {
  const token = randomUUID();
  const found: Array<Fresh> = [];
  gathering.set(token, found);
  try {
    const headers = new Headers({ [FRESH]: token, accept: "text/html" });
    const language = event.request.headers.get("accept-language");
    if (language != null) {
      headers.set("accept-language", language);
    }
    config.prepare({ url: target, headers }, event);
    const response = await event.fetch(target, { headers });
    await response.arrayBuffer();
    return { status: response.status, found };
  } catch {
    return { status: 502, found };
  } finally {
    gathering.delete(token);
  }
}

function privately(status: number, body: string | null = null) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": PRIVATE,
      ...(status === 503 && { "retry-after": "1" }),
    },
  });
}

async function freshen(event: RequestEvent) {
  const target = event.request.method === "GET" ? pageOf(event) : null;
  if (target == null) {
    return privately(404);
  }
  const page = target.pathname;
  return tracedAsync(
    event,
    "fresh",
    {
      "svelte-islands.fresh.page": page,
      "svelte-islands.fresh.queue": freshTurns.queued(),
    },
    async (span) => {
      const outcome = (status: string) =>
        span?.setAttribute("svelte-islands.fresh.outcome", status);
      return gatherFor(target, event, outcome);
    },
  );
}

async function gatherFor(
  target: URL,
  event: RequestEvent,
  outcome: (status: "ran" | "barren" | "busy") => void,
) {
  const page = target.pathname;
  const isKnown = freshPages.has(page);
  if (!isKnown && (barren.get(page) ?? 0) > Date.now()) {
    outcome("barren");
    return privately(404);
  }
  if (!isKnown && freshTurns.isFull()) {
    outcome("busy");
    return privately(503);
  }
  outcome("ran");
  const work = async () => gatherFresh(target, event);
  const { status, found } = isKnown
    ? await work()
    : await freshTurns.pass(work);
  if (status === 200 && found.length > 0) {
    freshPages.add(page);
    bound(freshPages, PAGES);
    barren.delete(page);
  } else if (!isKnown) {
    barren.set(page, Date.now() + limits().cooldown);
    bound(barren, PAGES);
  }
  if (status !== 200 && status !== 404) {
    warnOnce(dev ? `fresh:${page}` : "fresh", () =>
      console.warn(
        coded(
          "islands_fresh_failed",
          `The server couldn't render ${page} for its fresh islands, so they show the page's own values. The server can't render a prerendered page again, so render the page on the server and cache it with cache-control instead.`,
        ),
      ),
    );
  }
  return status === 200
    ? privately(200, serialize(found, true))
    : privately(502);
}

async function respond(event: RequestEvent) {
  const file = event.url.pathname.slice(settings.prefix.length);
  if (file === "fresh") {
    return freshen(event);
  }
  const key = file.replace(/\.json$/u, "");
  const isRead = ["GET", "HEAD"].includes(event.request.method);
  if (isRead && `${key}.json` === SHAPES) {
    return shapes(event);
  }
  if (!isRead || !FILE.test(file)) {
    return new Response(null, { status: 404 });
  }
  const etag = `"${file}"`;
  if (event.request.headers.get("if-none-match")?.includes(file) === true) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": IMMUTABLE, vary: "accept-encoding" },
    });
  }
  let text: string | null = null;
  try {
    text =
      recent.get(key) ??
      (await quietly(config.store?.get(`p:${key}`))) ??
      (await recover(key, event));
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "1" },
    });
  }
  if (text == null) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const compressed = await encoded(file, text, event);
  const type = file.endsWith(".html")
    ? "text/html; charset=utf-8"
    : "application/json; charset=utf-8";
  const init: ResponseInit & typeof ALREADY_ENCODED = {
    ...ALREADY_ENCODED,
    headers: {
      "content-type": type,
      "cache-control": IMMUTABLE,
      vary: "accept-encoding",
      etag: compressed == null ? etag : `"${file}-br"`,
      ...(compressed != null && { "content-encoding": "br" }),
    },
  };
  return new Response(compressed ?? text, init);
}

function lifetimeOf(platform: unknown) {
  if (typeof platform !== "object" || platform == null) {
    return null;
  }
  const { ctx, context } = platform as {
    ctx?: { waitUntil?: (work: Promise<unknown>) => void };
    context?: { waitUntil?: (work: Promise<unknown>) => void };
  };
  return ctx ?? context ?? null;
}

async function settle(event: RequestEvent) {
  const writes = requests.get(event.locals)?.writes ?? [];
  if (writes.length === 0) {
    return;
  }
  const work = Promise.all(writes);
  const lifetime = lifetimeOf(event.platform);
  if (lifetime?.waitUntil != null) {
    lifetime.waitUntil(work);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(resolve, SETTLE);
    }),
  ]);
  clearTimeout(timer);
}

function watchCookies(event: RequestEvent) {
  const { cookies } = event;
  const found = track(event.locals);
  const { get, getAll } = cookies;
  cookies.get = (...args) => {
    found.isPersonal = true;
    return get.apply(cookies, args);
  };
  cookies.getAll = (...args) => {
    found.isPersonal = true;
    return getAll.apply(cookies, args);
  };
}

const handler: Handle = async ({ event, resolve }) => {
  await startTracing(event);
  if (event.url.pathname.startsWith(settings.prefix)) {
    return respond(event);
  }
  if (dev && config.warnOnCookies) {
    watchCookies(event);
  }
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => inject(html, event),
  });
  if (
    !config.shareStreamed &&
    requests.get(event.locals)?.isStreamed === true &&
    !response.headers.has("cache-control")
  ) {
    response.headers.set("cache-control", "private, no-cache");
  }
  await settle(event);
  return response;
};

/**
 * The SvelteKit handle that serves parts and deferred HTML and adds preload links.
 * Add it to `sequence()` in `hooks.server.ts`.
 *
 * @param options Settings for the handle.
 */
export function handle({
  store = null,
  memory = config.memory,
  prepare = () => {},
  vary = () => "",
  rebuild: limits = {},
  compress = true,
  warnOnCookies = true,
  shareStreamed = false,
  speculation = false,
  viewTransitions = false,
}: {
  /** Persists parts, deferred HTML, and skeletons across restarts and servers. */
  store?: Store | null;
  /** How many characters of parts and deferred HTML to keep in memory. The default is 64 MiB. */
  memory?: number;
  /** Adjusts the internal request used to rebuild a part. */
  prepare?: Prepare;
  /** Returns anything other than an island's data that changes its text, such as the locale. */
  vary?: (event: RequestEvent) => string;
  /** Limits on rerunning a page to recover a missing part, or `false` to answer 404 instead. Fresh requests for a page not yet known to have fresh islands wait behind the same `concurrency` and `queue`. */
  rebuild?: RebuildOptions | false;
  /** Serves parts and the skeleton file with Brotli when the browser accepts it. The default is `true`. */
  compress?: boolean;
  /** Warns in dev when a public part is made after a request read cookies. The default is `true`. */
  warnOnCookies?: boolean;
  /**
   * Lets shared caches keep a response in which `stream()` left a promise
   * pending. The default is `false`: such a response gets
   * `cache-control: private, no-cache` unless it already has a `cache-control`,
   * so a CDN never keeps a copy whose HTML holds skeletons instead of content.
   */
  shareStreamed?: boolean;
  /**
   * Adds Speculation Rules to pages with `csr = false`, so the browser
   * prefetches or prerenders a same-origin page when a link is hovered. Links
   * with `data-sveltekit-preload-data="false"`, or inside an element with it, are left alone. The default is `false`.
   */
  speculation?: Speculation;
  /** Adds cross-document View Transitions to every page. The default is `false`. */
  viewTransitions?: boolean;
} = {}): Handle {
  config.store = store;
  config.memory = memory;
  config.prepare = prepare;
  config.vary = vary;
  config.rebuild = limits === false ? null : { ...REBUILD_DEFAULTS, ...limits };
  config.compress = compress;
  config.warnOnCookies = warnOnCookies;
  config.shareStreamed = shareStreamed;
  config.speculation = speculation;
  config.viewTransitions = viewTransitions;
  return handler;
}

/**
 * Waits a short while for slow values in a server `load`, then lets the rest
 * stream.
 *
 * Each value that settles within `budget` milliseconds comes back as itself, so
 * the page renders it into the server HTML. Each one still pending comes back as
 * its promise, which SvelteKit streams to the browser, and `<Await>` shows a
 * learned skeleton until it arrives. A rejected value comes back as its rejected
 * promise, so `<Await>` shows its `failed` snippet.
 *
 * Pass `budget: Infinity` to wait for everything, for example for crawlers that
 * don't run JavaScript.
 *
 * @param values The promises to wait for, by name.
 * @param options How long to wait.
 * @returns The same names, each holding its value or its pending promise.
 */
export async function stream<T extends Record<string, unknown>>(
  values: T,
  {
    budget = 150,
  }: {
    /** How many milliseconds to wait before streaming what is still pending. The default is 150. */
    budget?: number;
  } = {},
): Promise<{ [K in keyof T]: Awaited<T[K]> | Promise<Awaited<T[K]>> }> {
  const event = getRequestEvent();
  const entries = Object.entries(values);
  const settled = new Map<string, { value: unknown }>();
  const rejected = new Set<string>();
  const watched = entries.map(async ([key, value]) => {
    try {
      settled.set(key, { value: await value });
    } catch {
      rejected.add(key);
    }
  });
  if (budget === Infinity) {
    await Promise.all(watched);
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(watched),
      new Promise((done) => {
        timer = setTimeout(done, Math.max(0, budget));
      }),
    ]);
    clearTimeout(timer);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const found = settled.get(key);
    if (found != null) {
      result[key] = found.value;
      continue;
    }
    if (value instanceof Promise && !rejected.has(key)) {
      track(event.locals).isStreamed = true;
    }
    result[key] = value;
  }
  return result as { [K in keyof T]: Awaited<T[K]> | Promise<Awaited<T[K]>> };
}
