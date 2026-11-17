import { context } from "svelte-islands";

export const [getTone, setTone] = context<string>("tone");

export const hidden = Symbol("hidden");
