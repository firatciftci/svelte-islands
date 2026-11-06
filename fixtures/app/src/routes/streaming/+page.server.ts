import { stream } from "svelte-islands/server";

function after<T>(ms: number, value: T) {
  return new Promise<T>((done) => {
    setTimeout(done, ms, value);
  });
}

function failing(ms: number) {
  return new Promise<never>((_, fail) => {
    setTimeout(fail, ms, new Error("broken"));
  });
}

export async function load({ url }) {
  const topic = url.searchParams.get("topic") ?? "a";
  const view = url.searchParams.get("view") ?? "1";
  const slow = Number(url.searchParams.get("slow") ?? 800);
  const lines = Array.from(
    { length: 80 },
    (_, at) => `line ${at + 1} of ${topic}`,
  );
  const streamed = await stream(
    {
      quick: after(5, `quick ${topic} ${view}`),
      body: after(slow, { topic, view, lines }),
      broken: url.searchParams.has("broken") ? failing(50) : null,
    },
    { budget: url.searchParams.has("full") ? Infinity : 150 },
  );
  return { topic, view, ...streamed };
}
