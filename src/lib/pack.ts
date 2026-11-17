import {
  DICTIONARY,
  NESTED,
  NULLABLE,
  PLAIN,
  RUNS,
  SPARSE,
  TABLE,
  UNDEFINED,
} from "./unpack.js";

type Value =
  | undefined
  | null
  | boolean
  | number
  | string
  | Array<Value>
  | { [key: string]: Value };

type Json =
  | null
  | boolean
  | number
  | string
  | Array<Json>
  | { [key: string]: Json };

type Row = Record<string, Value>;

type Walk = {
  seen: Set<object>;
  claims: ReadonlyArray<(value: unknown) => unknown>;
};

function isRow(value: Value): value is Row {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(
  value: unknown,
): value is null | undefined | boolean | number | string {
  return value == null || typeof value !== "object";
}

function isFlat(value: object) {
  return Object.values(value).every((item) => isPrimitive(item));
}

function isPackableObject(value: object, walk: Walk) {
  if (Array.isArray(value)) {
    const items: Array<unknown> = value;
    for (const [index, item] of items.entries()) {
      if (
        (item === undefined && !Object.hasOwn(items, index)) ||
        !isPackableWithin(item, walk)
      ) {
        return false;
      }
    }
    return true;
  }
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(value).every((item) => isPackableWithin(item, walk))
  );
}

function isPackableWithin(value: unknown, walk: Walk): value is Value {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (walk.seen.has(value)) {
    return isFlat(value);
  }
  if (walk.claims.some((isClaimed) => Boolean(isClaimed(value)))) {
    return false;
  }
  walk.seen.add(value);
  return isPackableObject(value, walk);
}

export function isPackable(
  value: unknown,
  claims: ReadonlyArray<(value: unknown) => unknown> = [],
): value is Value {
  return isPackableWithin(value, { seen: new Set(), claims });
}

function runs(cells: Array<Value>) {
  if (cells.length < 8) {
    return null;
  }
  const bounds: Array<number> = [];
  let last: number | null = null;
  for (const cell of cells) {
    if (typeof cell !== "number" || !Number.isSafeInteger(cell)) {
      return null;
    }
    if (last != null && cell <= last) {
      return null;
    }
    if (last != null && cell === last + 1) {
      bounds[bounds.length - 1] = cell;
    } else {
      bounds.push(cell, cell);
      if (bounds.length > cells.length / 4) {
        return null;
      }
    }
    last = cell;
  }
  return [RUNS, ...bounds];
}

function sparse(cells: Array<Value>) {
  if (cells.length < 8) {
    return null;
  }
  for (const fill of [0, null]) {
    const indices: Array<number> = [];
    const kept: Array<Value> = [];
    for (const [index, cell] of cells.entries()) {
      if (cell === fill) {
        continue;
      }
      indices.push(index);
      kept.push(cell);
      if (indices.length > cells.length / 4) {
        break;
      }
    }
    if (indices.length <= cells.length / 4) {
      return [SPARSE, cells.length, fill, indices, list(kept)];
    }
  }
  return null;
}

function weigh(value: Value) {
  return value === undefined ? 3 : JSON.stringify(value).length;
}

function fingerprint(cell: Value) {
  if (Array.isArray(cell)) {
    return `a${JSON.stringify(cell.map((item) => (item === undefined ? [] : item)))}`;
  }
  if (isRow(cell)) {
    return `r${JSON.stringify(
      Object.entries(cell).map(([name, item]) =>
        item === undefined ? [name] : [name, item],
      ),
    )}`;
  }
  return null;
}

function dictionary(cells: Array<Value>) {
  if (
    cells.length < 4 ||
    cells.some((cell) => !isPrimitive(cell) && !isFlat(cell))
  ) {
    return null;
  }
  const values = new Map<Value, number>();
  const composites = new Map<string, number>();
  const distinct: Array<Value> = [];
  const indexes: Array<number> = [];
  let plain = 0;
  let packed = 0;
  for (const cell of cells) {
    const print = fingerprint(cell);
    const size = print?.length ?? weigh(cell);
    plain += size + 1;
    let spot = print == null ? values.get(cell) : composites.get(print);
    if (spot == null) {
      spot = distinct.length;
      if (print == null) {
        values.set(cell, spot);
      } else {
        composites.set(print, spot);
      }
      distinct.push(cell);
      packed += size + 1;
    }
    indexes.push(spot);
    packed += String(spot).length + 1;
  }
  const isWorth =
    composites.size > 0 ? distinct.length * 2 <= cells.length : packed < plain;
  return isWorth ? [DICTIONARY, list(distinct), indexes] : null;
}

function table(cells: Array<Value>) {
  const [first] = cells;
  if (first == null || cells.length < 2 || !isRow(first)) {
    return null;
  }
  const keys = Object.keys(first);
  if (keys.length === 0) {
    return null;
  }
  const rows: Array<Row> = [];
  for (const cell of cells) {
    if (!isRow(cell)) {
      return null;
    }
    const own = Object.keys(cell);
    if (own.length !== keys.length || own.some((key, at) => key !== keys[at])) {
      return null;
    }
    rows.push(cell);
  }
  return [TABLE, keys, ...keys.map((key) => list(rows.map((row) => row[key])))];
}

function nullable(cells: Array<Value>) {
  if (
    cells.length < 2 ||
    !cells.includes(null) ||
    cells.every((cell) => isPrimitive(cell))
  ) {
    return null;
  }
  const empty: Array<number> = [];
  const kept: Array<Value> = [];
  for (const [index, cell] of cells.entries()) {
    if (cell === null) {
      empty.push(index);
    } else {
      kept.push(cell);
    }
  }
  return [NULLABLE, empty, list(kept)];
}

function nested(cells: Array<Value>) {
  if (
    cells.length < 2 ||
    cells.some((cell) => cell != null && !Array.isArray(cell))
  ) {
    return null;
  }
  const merged = [
    NESTED,
    cells.map((cell) =>
      Array.isArray(cell) ? cell.length : cell === null ? -1 : -2,
    ),
    list(cells.flatMap((cell) => cell ?? [])),
  ];
  if (cells.some((cell) => Array.isArray(cell) && !isFlat(cell))) {
    return merged;
  }
  const separate = [PLAIN, ...cells.map((cell) => pack(cell))];
  return JSON.stringify(merged).length <= JSON.stringify(separate).length
    ? merged
    : separate;
}

function list(cells: Array<Value>): Array<Json> {
  return (
    runs(cells) ??
    sparse(cells) ??
    dictionary(cells) ??
    table(cells) ??
    nullable(cells) ??
    nested(cells) ?? [PLAIN, ...cells.map((cell) => pack(cell))]
  );
}

export function pack(value: Value): Json {
  if (value === undefined) {
    return [UNDEFINED];
  }
  if (Array.isArray(value)) {
    return list(value);
  }
  if (isRow(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, pack(item)]),
    );
  }
  return value;
}
