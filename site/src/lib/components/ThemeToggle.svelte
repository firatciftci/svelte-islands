<script lang="ts">
  const KEY = "color-scheme";

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function save(value: string | null) {
    try {
      if (value == null) {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, value);
      }
    } catch {}
  }

  function apply(value: string | null) {
    const meta = document.querySelector('meta[name="color-scheme"]');
    meta?.setAttribute("content", value ?? "light dark");
  }

  function toggle() {
    const system = matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    const target = (stored() ?? system) === "dark" ? "light" : "dark";
    const next = target === system ? null : target;
    save(next);
    apply(next);
  }

  function synced(event: StorageEvent) {
    if (event.key === KEY) {
      apply(event.newValue);
    }
  }
</script>

<svelte:window onstorage={synced} />

<button type="button" class="tool theme-toggle" onclick={toggle}>
  <span class="to-night">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
    <span class="visually-hidden">Switch to night colors</span>
  </span>
  <span class="to-day">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"
      />
    </svg>
    <span class="visually-hidden">Switch to day colors</span>
  </span>
</button>
