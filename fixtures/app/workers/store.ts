import { env } from "cloudflare:workers";
import { r2Store } from "svelte-islands/stores";

export const store = r2Store(() => env.PARTS);
