import type { RequestEvent } from "@sveltejs/kit";

const state: { event: RequestEvent | null } = { event: null };

export function enter(event: RequestEvent) {
  state.event = event;
}

export function getRequestEvent() {
  if (state.event == null) {
    throw new Error("no request");
  }
  return state.event;
}
