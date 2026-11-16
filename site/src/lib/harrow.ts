export type Harbor = {
  id: number;
  name: string;
  arrivals: number;
  departures: number;
  cargo: number;
  onTime: number;
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

export function harbors(count: number, seed: number) {
  const next = random(seed);
  const rows: Array<Harbor> = [];
  for (let id = 1; id <= count; id += 1) {
    const first = FIRST[Math.floor(next() * FIRST.length)] ?? "Harrow";
    const second = SECOND[Math.floor(next() * SECOND.length)] ?? "Sound";
    rows.push({
      id,
      name: `${first} ${second} ${id}`,
      arrivals: Math.floor(800 + next() * 9000),
      departures: Math.floor(800 + next() * 9000),
      cargo: Math.floor(200 + next() * 4000),
      onTime: Math.round((55 + next() * 44) * 10) / 10,
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

export type Comment = {
  id: number;
  author: string;
  hours: number;
  text: string;
  likes: number;
};

const AUTHORS = [
  "Ines Corran",
  "Tomas Quill",
  "Maren Sable",
  "Owen Thole",
  "Ada Fenner",
  "Rhys Ottery",
  "Lena Brindle",
  "Joss Yarrow",
  "Nell Skerry",
  "Arlo Wick",
];

const REMARKS = [
  "The new tables finally match what the gauge at the north pier reads. Thank you.",
  "Is the spring low on the 14th really that low? Our mooring dries out below 0.4 meters.",
  "Printed these and taped them inside the wheelhouse. Old habits.",
  "Would love a version with the times in UTC for those of us who cross the bay.",
  "The chart of the Narrows is much easier to read now that the soundings are larger.",
  "Can someone confirm whether the ferry timetable follows these or the old ones?",
  "Tidal range at Kettle Reach looks off by about ten minutes compared with last year.",
  "We run the harbor launch and these are the first tables I have trusted in a while.",
  "Good to see the neap tides marked. That used to be guesswork.",
  "Any plans to publish the wave heights alongside the heights of tide?",
  "My grandfather kept these by hand in a ledger. He would have liked this.",
  "The sunrise column is a nice touch for those of us fishing at dawn.",
];

function remark(next: () => number) {
  const first = Math.floor(next() * REMARKS.length);
  const second =
    (first + 1 + Math.floor(next() * (REMARKS.length - 1))) % REMARKS.length;
  return `${REMARKS[first] ?? ""} ${REMARKS[second] ?? ""}`;
}

export function comments(count: number, seed: number) {
  const next = random(seed);
  const made: Array<Comment> = [];
  let hours = 1;
  for (let id = 1; id <= count; id += 1) {
    hours += Math.floor(next() * 9);
    made.push({
      id,
      author: AUTHORS[Math.floor(next() * AUTHORS.length)] ?? "Ines Corran",
      hours,
      text: remark(next),
      likes: Math.floor(next() * 40),
    });
  }
  return made;
}
