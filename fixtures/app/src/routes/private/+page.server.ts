import { part } from "svelte-islands/server";

export const load = ({ cookies }) => {
  const who = cookies.get("who") ?? "nobody";
  return {
    account: part(
      "account",
      { who, secret: `secret-for-${who}`, notes: "n".repeat(9000) },
      { private: true },
    ),
  };
};
