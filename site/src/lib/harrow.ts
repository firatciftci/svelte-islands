export type Ward = {
  id: number;
  name: string;
  tide: number;
  beacon: number;
  harbor: number;
  turnout: number;
};

const FIRST = [
  "Harrow",
  "Kettle",
  "Marrow",
  "Gannet",
  "Skerry",
  "Tarn",
  "Quill",
  "Brindle",
  "Sable",
  "Corran",
  "Fenner",
  "Ottery",
  "Pike",
  "Rook",
  "Saltmarsh",
  "Thole",
  "Wick",
  "Yarrow",
];

const SECOND = [
  "Sound",
  "Reach",
  "Head",
  "Bank",
  "Narrows",
  "Roads",
  "Point",
  "Ledge",
  "Haven",
  "Spit",
];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function wards(count: number, seed: number) {
  const next = random(seed);
  const rows: Array<Ward> = [];
  for (let id = 1; id <= count; id += 1) {
    const first = FIRST[Math.floor(next() * FIRST.length)] ?? "Harrow";
    const second = SECOND[Math.floor(next() * SECOND.length)] ?? "Sound";
    rows.push({
      id,
      name: `${first} ${second} ${id}`,
      tide: Math.floor(800 + next() * 9000),
      beacon: Math.floor(800 + next() * 9000),
      harbor: Math.floor(200 + next() * 4000),
      turnout: Math.round((40 + next() * 45) * 10) / 10,
    });
  }
  return rows;
}

export function scatter(count: number, seed: number) {
  const next = random(seed);
  const places: Array<{ x: number; y: number }> = [];
  let tries = 0;
  while (places.length < count && tries < count * 60) {
    tries += 1;
    const x = next() * 0.97;
    const y = next() * 0.8;
    const room = places.every(
      (place) => Math.hypot((place.x - x) * 4, place.y - y) > 0.32,
    );
    if (room) {
      places.push({ x, y });
    }
  }
  return places;
}
