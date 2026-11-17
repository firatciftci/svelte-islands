import type { Cookies } from "@sveltejs/kit";
import { fresh } from "svelte-islands/server";

export async function visitorParts(cookies: Cookies) {
  const nameOf = () => cookies.get("visitor") ?? "guest";
  return {
    visitor: await fresh("fresh.visitor", () => ({ name: nameOf() }), {
      name: "guest",
    }),
    basket: await fresh("fresh.basket", () => ({ items: itemsOf(nameOf()) }), {
      items: itemsOf("guest"),
    }),
  };
}

function itemsOf(name: string) {
  return Array.from({ length: 200 }, (_, index) => `${name} item ${index}`);
}
