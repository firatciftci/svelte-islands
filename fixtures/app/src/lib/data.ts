export type Row = { id: number; name: string; votes: number };

export function rowsFor(label: string, seed = "", count = 300) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    name: `${label} ${id}`,
    votes: id * 17,
    seed,
  }));
}
