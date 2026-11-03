import type { Transport } from "@sveltejs/kit/hooks";
import type { Snippet } from "svelte";
import { parse, stringify } from "devalue";

export type Strategy = "visible" | "idle" | "interaction" | "eager" | "never";

export const settings = { inline: 4096, prefix: "/_parts/" };

export class Part<T = unknown> {
  readonly name: string;
  readonly hash: string;
  readonly source: string;
  readonly bytes: number;
  readonly isEager: boolean;
  readonly skeletons: Record<string, string> | null;
  readonly loaded: { value: T } | null;

  constructor({
    name,
    hash,
    source,
    bytes,
    isEager = false,
    skeletons = null,
    loaded = null,
  }: {
    name: string;
    hash: string;
    source: string;
    bytes: number;
    isEager?: boolean;
    skeletons?: Record<string, string> | null;
    loaded?: { value: T } | null;
  }) {
    this.name = name;
    this.hash = hash;
    this.source = source;
    this.bytes = bytes;
    this.isEager = isEager;
    this.skeletons = skeletons;
    this.loaded = loaded;
  }

  get isInline() {
    return this.loaded != null && this.bytes <= settings.inline;
  }
}

export type Scope = {
  isData: boolean;
  render: (
    body: Snippet<[never]>,
    value: unknown,
    context: Map<unknown, unknown>,
    prefix: string,
  ) => string;
  rendered: (part: Part, key: string, html: string) => void;
  exemplars: (name: string) => Record<string, string> | null;
};

const state: {
  read: () => Scope | null;
  arrived: (part: Part) => void;
  reducers: Record<string, (value: unknown) => unknown>;
  revivers: Record<string, (value: unknown) => unknown>;
} = { read: () => null, arrived: () => {}, reducers: {}, revivers: {} };

export function provide(reader: () => Scope | null) {
  state.read = reader;
}

export function scope() {
  return state.read();
}

export function onArrival(handler: (part: Part) => void) {
  state.arrived = handler;
}

export async function quietly<T>(
  promise: Promise<T> | undefined,
): Promise<T | null> {
  try {
    return (await promise) ?? null;
  } catch {
    return null;
  }
}

type Head = [
  name: string,
  hash: string,
  source: string,
  bytes: number,
  isEager: 0 | 1,
  skeletons: Record<string, string> | null,
];

type Encoded = Head | [...Head, unknown];

function encode(
  value: unknown,
  isData: boolean,
  skeletons: Record<string, string> | null,
) {
  if (!(value instanceof Part)) {
    return false;
  }
  const head: Head = [
    value.name,
    value.hash,
    value.source,
    value.bytes,
    isData ? 1 : 0,
    value.isInline ? null : skeletons,
  ];
  const encoded: Encoded =
    value.isInline && value.loaded != null
      ? [...head, value.loaded.value]
      : head;
  return encoded;
}

function decode(encoded: Encoded) {
  const [name, hash, source, bytes, isEager, skeletons] = encoded;
  const part = new Part({
    name,
    hash,
    source,
    bytes,
    isEager: isEager === 1,
    skeletons,
    loaded: encoded.length > 6 ? { value: encoded[6] } : null,
  });
  state.arrived(part);
  return part;
}

const codec = {
  encode: (value: unknown) => {
    const current = scope();
    const isData = current?.isData === true;
    return encode(
      value,
      isData,
      isData && value instanceof Part ? current.exemplars(value.name) : null,
    );
  },
  decode,
};

const LONG = 64;
const ROWS = 16;

const sparse = {
  encode: (value: unknown) => {
    if (!Array.isArray(value) || value.length < LONG) {
      return false;
    }
    const items: Array<unknown> = value;
    for (const fill of [0, null]) {
      const indices: Array<number> = [];
      const kept: Array<unknown> = [];
      for (const [index, item] of items.entries()) {
        if (item === fill) {
          continue;
        }

        indices.push(index);
        kept.push(item);
        if (indices.length > items.length / 4) {
          break;
        }
      }
      if (indices.length <= items.length / 4) {
        return [items.length, fill, indices, kept];
      }
    }
    return false;
  },
  decode: ([length, fill, indices, kept]: [
    number,
    0 | null,
    Array<number>,
    Array<unknown>,
  ]) => {
    const spots = new Map(indices.map((index, at) => [index, at]));
    return Array.from({ length }, (_, index) => {
      const at = spots.get(index);
      return at == null ? fill : kept[at];
    });
  },
};

const runs = {
  encode: (value: unknown) => {
    if (!Array.isArray(value) || value.length < LONG) {
      return false;
    }
    const items: Array<unknown> = value;
    const bounds: Array<number> = [];
    let last: number | null = null;
    for (const item of items) {
      if (
        typeof item !== "number" ||
        !Number.isSafeInteger(item) ||
        (last != null && item <= last)
      ) {
        return false;
      }
      if (last != null && item === last + 1) {
        bounds[bounds.length - 1] = item;
      } else {
        bounds.push(item, item);
        if (bounds.length > items.length / 4) {
          return false;
        }
      }
      last = item;
    }
    return bounds;
  },
  decode: (bounds: Array<number>) =>
    bounds.flatMap((start, at) =>
      at % 2 === 0
        ? Array.from(
            { length: (bounds[at + 1] ?? start) - start + 1 },
            (_, step) => start + step,
          )
        : [],
    ),
};

function isPlain(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isFlat(value: unknown, seen: Set<unknown>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (
    !Array.isArray(value) ||
    value.length >= LONG ||
    seen.has(value) ||
    Object.keys(value).length !== value.length
  ) {
    return false;
  }
  seen.add(value);
  const items: Array<unknown> = value;
  return items.every((item) => isFlat(item, seen));
}

const table = {
  encode: (value: unknown) => {
    if (!Array.isArray(value) || value.length < ROWS) {
      return false;
    }
    const rows: Array<unknown> = value;
    const first = rows[0];
    if (!isPlain(first)) {
      return false;
    }
    const keys = Object.keys(first);
    if (keys.length === 0) {
      return false;
    }
    const seen = new Set<unknown>();
    const columns = keys.map((): Array<unknown> => []);
    for (const row of rows) {
      if (!isPlain(row) || seen.has(row)) {
        return false;
      }
      seen.add(row);
      const own = Object.keys(row);
      if (
        own.length !== keys.length ||
        own.some((key, at) => key !== keys[at])
      ) {
        return false;
      }
      for (const [at, key] of keys.entries()) {
        columns[at]?.push(row[key]);
      }
    }
    const flat = new Set<unknown>();
    return [
      keys,
      ...columns.map((column) =>
        column.every((cell) => isFlat(cell, flat))
          ? JSON.stringify(column)
          : column,
      ),
    ];
  },
  decode: ([keys, ...columns]: [
    Array<string>,
    ...Array<string | Array<unknown>>,
  ]) => {
    const cells = columns.map((column): Array<unknown> => {
      if (typeof column !== "string") {
        return column;
      }
      const parsed: unknown = JSON.parse(column);
      return Array.isArray(parsed) ? parsed : [];
    });
    return Array.from({ length: cells[0]?.length ?? 0 }, (_, index) =>
      Object.fromEntries(keys.map((key, at) => [key, cells[at]?.[index]])),
    );
  },
};

const compact = { sparse, runs, table };

const nested = {
  encode: (value: unknown) => encode(value, false, null),
  decode,
};

function index(codecs: Transport) {
  const merged: Transport = { ...codecs, ...compact, part: nested };
  const all = Object.entries(merged);
  state.reducers = Object.fromEntries(
    all.map(([key, { encode: reduce }]) => [
      key,
      (value: unknown): unknown => reduce(value),
    ]),
  );
  state.revivers = Object.fromEntries(
    all.map(([key, { decode: revive }]) => [
      key,
      (value: unknown): unknown => revive(value),
    ]),
  );
}

index({});

export function islands({
  codecs = {},
  inline = settings.inline,
  prefix = settings.prefix,
}: { codecs?: Transport; inline?: number; prefix?: string } = {}) {
  settings.inline = inline;
  settings.prefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  index(codecs);
  return { ...codecs, ...compact, part: codec } satisfies Transport;
}

export function serialize(value: unknown) {
  return stringify(value, state.reducers);
}

export function deserialize(text: string): unknown {
  return parse(text, state.revivers);
}
