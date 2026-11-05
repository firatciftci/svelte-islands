import { store } from "#store";
import { handle as islands } from "svelte-islands/server";

export const handle = islands({ store });
