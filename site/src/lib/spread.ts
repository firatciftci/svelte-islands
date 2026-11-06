export function spread(
  items: Array<{ at: number; size: number }>,
  height: number,
) {
  const down: Array<number> = [];
  let floor = 0;
  for (const { at, size } of items) {
    const placed = Math.max(at, floor);
    down.push(placed);
    floor = placed + size;
  }
  const up: Array<number> = [];
  let ceiling = height;
  const reversed = items.toReversed();
  for (const [index, placed] of down.toReversed().entries()) {
    const position = Math.min(placed, ceiling - (reversed[index]?.size ?? 0));
    up.push(position);
    ceiling = position;
  }
  return up.toReversed();
}
