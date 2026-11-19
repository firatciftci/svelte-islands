import { part } from "svelte-islands/server";

export function rows() {
  return part(
    "size.rows",
    Array.from({ length: 20 }, (_, index) => ({
      id: index,
      label: `Row ${index}`,
    })),
  );
}
