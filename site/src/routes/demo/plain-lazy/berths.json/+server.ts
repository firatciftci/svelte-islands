import { json } from "@sveltejs/kit";
import { berths } from "../../data";

export const prerender = true;

export function GET() {
  return json(berths);
}
