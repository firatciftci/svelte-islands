export const PLAIN = 0;
export const TABLE = 1;
export const DICTIONARY = 2;
export const NESTED = 3;
export const RUNS = 4;
export const SPARSE = 5;
export const NULLABLE = 6;
export const UNDEFINED = 7;

function numbers(value: unknown) {
  return Array.isArray(value) ? (value as Array<number>) : [];
}

function put(row: Record<string, unknown>, name: string, value: unknown) {
  if (name === "__proto__") {
    Object.defineProperty(row, name, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } else {
    row[name] = value;
  }
}

function untable(keys: unknown, columns: Array<unknown>) {
  const names = Array.isArray(keys) ? keys.map(String) : [];
  const cells = columns.map((column) => unlist(column));
  const rows: Array<unknown> = [];
  for (let index = 0; index < (cells[0]?.length ?? 0); index += 1) {
    const row: Record<string, unknown> = {};
    let at = 0;
    for (const name of names) {
      put(row, name, cells[at]?.[index]);
      at += 1;
    }
    rows.push(row);
  }
  return rows;
}

function unruns(bounds: Array<number>) {
  const cells: Array<number> = [];
  let start: number | null = null;
  for (const bound of bounds) {
    if (start == null) {
      start = bound;
    } else {
      for (let cell = start; cell <= bound; cell += 1) {
        cells.push(cell);
      }
      start = null;
    }
  }
  return cells;
}

function unsparse(
  length: unknown,
  fill: unknown,
  indices: unknown,
  kept: unknown,
) {
  const cells = new Array<unknown>(Number(length)).fill(fill);
  const items = unlist(kept);
  let at = 0;
  for (const index of numbers(indices)) {
    cells[index] = items[at];
    at += 1;
  }
  return cells;
}

function unlist(node: unknown): Array<unknown> {
  if (!Array.isArray(node)) {
    return [];
  }
  const fields: Array<unknown> = node;
  const tag = fields[0];
  const rest = fields.slice(1);
  if (tag === TABLE) {
    return untable(rest[0], rest.slice(1));
  }
  if (tag === DICTIONARY) {
    const distinct = unlist(rest[0]);
    return numbers(rest[1]).map((spot) => {
      const value = distinct[spot];
      if (Array.isArray(value)) {
        const items: Array<unknown> = value;
        return [...items];
      }
      return value !== null && typeof value === "object" ? { ...value } : value;
    });
  }
  if (tag === NESTED) {
    const items = unlist(rest[1]);
    let at = 0;
    return numbers(rest[0]).map((length) => {
      if (length < 0) {
        return length === -1 ? null : undefined;
      }
      at += length;
      return items.slice(at - length, at);
    });
  }
  if (tag === RUNS) {
    return unruns(numbers(rest));
  }
  if (tag === SPARSE) {
    return unsparse(rest[0], rest[1], rest[2], rest[3]);
  }
  if (tag === NULLABLE) {
    const empty = new Set(numbers(rest[0]));
    const items = unlist(rest[1]);
    let at = 0;
    return Array.from({ length: empty.size + items.length }, (_, index) => {
      if (empty.has(index)) {
        return null;
      }
      at += 1;
      return items[at - 1];
    });
  }
  return rest.map((item) => unpack(item));
}

export function unpack(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node[0] === UNDEFINED ? undefined : unlist(node);
  }
  if (node !== null && typeof node === "object") {
    const row: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      put(row, key, unpack(item));
    }
    return row;
  }
  return node;
}
