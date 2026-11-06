import { part } from "svelte-islands/server";
import { scatter, wards } from "#lib/harrow.js";
import { pages } from "#lib/server/docs.js";
import { render } from "#lib/server/markdown.js";
import recorded from "../../../../docs/benchmark.json";

const SETUP = `\`\`\`ts
/// file: src/hooks.ts
import { islands } from "svelte-islands";

export const transport = islands();
\`\`\`

\`\`\`ts
/// file: src/hooks.server.ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands();
\`\`\`

\`\`\`ts
/// file: src/routes/+layout.svelte
import "svelte-islands/styles.css";
\`\`\`
`;

const setup = await render(SETUP, () => ({ slug: "", hash: null }));

const BANDS = [
  { count: 11, seed: 3, shore: 0.72 },
  { count: 15, seed: 5, shore: 0.72 },
  { count: 5, seed: 9, shore: 1 },
];

function bands() {
  const sizes = pages
    .map(({ markdown }) => markdown.length / 1024)
    .toSorted((a, b) => a - b);
  let used = 0;
  return BANDS.map(({ count, seed, shore }) => {
    const places = scatter(count, seed).toSorted(
      (a, b) => Math.abs(a.x - shore) - Math.abs(b.x - shore),
    );
    const start = used;
    used += places.length;
    return places.map((place, index) => ({
      ...place,
      kb: (sizes[start + index] ?? sizes.at(-1) ?? 0).toFixed(1),
    }));
  });
}

export function load() {
  return {
    harrow: part("home.harrow", wards(200, 7)),
    deferred: part("home.deferred", wards(200, 19)),
    never: part("home.never", wards(200, 29)),
    client: part("home.client", wards(200, 31)),
    soundings: bands(),
    recorded,
    setup: setup.segments.flatMap((segment) =>
      segment.kind === "html" ? [segment.html] : [],
    ),
  };
}
