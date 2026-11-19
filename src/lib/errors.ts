export const CODES = [
  "islands_private_in_public",
  "islands_tbody_needs_server",
  "islands_part_after_cookies",
  "islands_await_while_rendering",
  "islands_shell_value",
  "islands_shell_context",
  "islands_csr_mismatch",
  "islands_fresh_failed",
  "islands_island_kept",
  "islands_no_code_splitting",
  "islands_missing_code",
  "islands_missing_children",
  "islands_part_failed",
] as const;

export const ERRORS =
  "https://firatciftci.github.io/svelte-islands/docs/appendix/errors";

export function coded(code: (typeof CODES)[number], message: string) {
  return `${code}\n${message}\n${ERRORS}#${code}`;
}
