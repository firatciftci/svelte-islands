<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { load, peek, type Part } from "svelte-islands";

  type Entry = {
    slug: string;
    id: string | null;
    page: string;
    heading: string | null;
    text: string;
  };

  let { index }: { index: Part<Array<Entry>> } = $props();

  function outside(event: PointerEvent, box: DOMRect) {
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }

  function lightDismiss(element: HTMLDialogElement) {
    if ("closedBy" in HTMLDialogElement.prototype) {
      return;
    }
    let pressedOutside = false;
    const pressed = (event: PointerEvent) => {
      pressedOutside = outside(event, element.getBoundingClientRect());
    };
    const released = (event: PointerEvent) => {
      if (pressedOutside && outside(event, element.getBoundingClientRect())) {
        element.close();
      }
    };
    element.addEventListener("pointerdown", pressed);
    element.addEventListener("pointerup", released);
    return () => {
      element.removeEventListener("pointerdown", pressed);
      element.removeEventListener("pointerup", released);
    };
  }

  let dialog = $state<HTMLDialogElement>();
  let query = $state("");
  let selected = $state(0);
  let status = $state<"idle" | "loading" | "failed">("idle");

  const entries = $derived(peek(index)?.value ?? null);

  function tokens(text: string) {
    return text
      .toLowerCase()
      .split(/\s+/u)
      .filter((token) => token !== "");
  }

  function score(entry: Entry, wanted: Array<string>) {
    const title = (entry.heading ?? entry.page).toLowerCase();
    const page = entry.page.toLowerCase();
    const text = entry.text.toLowerCase();
    let total = 0;
    for (const token of wanted) {
      if (title === token) {
        total += 100;
      } else if (title.startsWith(token)) {
        total += 60;
      } else if (title.includes(token)) {
        total += 40;
      } else if (page.includes(token)) {
        total += 20;
      } else if (text.includes(token)) {
        total += 5;
      } else {
        return 0;
      }
    }
    return entry.heading == null ? total + 50 : total;
  }

  const results = $derived.by(() => {
    const wanted = tokens(query);
    if (entries == null || wanted.length === 0) {
      return [];
    }
    const scored: Array<{ entry: Entry; total: number }> = [];
    for (const entry of entries) {
      const total = score(entry, wanted);
      if (total > 0) {
        scored.push({ entry, total });
      }
    }
    return scored
      .toSorted((a, b) => b.total - a.total)
      .slice(0, 12)
      .map(({ entry }) => entry);
  });

  function hrefOf(entry: Entry) {
    const path = resolve("/(site)/docs/[...slug]", { slug: entry.slug });
    return entry.id == null ? path : `${path}#${entry.id}`;
  }

  async function fetchIndex() {
    status = "loading";
    try {
      await load(index);
      status = "idle";
    } catch {
      status = "failed";
    }
  }

  export function open() {
    dialog?.showModal();
    if (entries == null && status !== "loading") {
      void fetchIndex();
    }
  }

  function snippet(entry: Entry) {
    const wanted = tokens(query);
    const lower = entry.text.toLowerCase();
    let at = -1;
    for (const token of wanted) {
      at = lower.indexOf(token);
      if (at !== -1) {
        break;
      }
    }
    if (at <= 40) {
      return entry.text.slice(0, 240);
    }
    const from = entry.text.indexOf(" ", at - 30) + 1;
    return `...${entry.text.slice(from, from + 240)}`;
  }

  function pieces(text: string) {
    const lower = text.toLowerCase();
    const hits: Array<{ from: number; to: number }> = [];
    for (const token of tokens(query)) {
      let at = lower.indexOf(token);
      while (at !== -1) {
        hits.push({ from: at, to: at + token.length });
        at = lower.indexOf(token, at + token.length);
      }
    }
    const parts: Array<{ text: string; isHit: boolean }> = [];
    let end = 0;
    for (const { from, to } of hits.toSorted((a, b) => a.from - b.from)) {
      if (to > end) {
        const start = Math.max(from, end);
        parts.push(
          { text: text.slice(end, start), isHit: false },
          { text: text.slice(start, to), isHit: true },
        );
        end = to;
      }
    }
    parts.push({ text: text.slice(end), isHit: false });
    return parts;
  }

  $effect(() => {
    document
      .getElementById(`search-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  });

  function moved(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
    } else if (event.key === "Enter") {
      const entry = results[selected];
      if (entry != null) {
        event.preventDefault();
        dialog?.close();
        void goto(hrefOf(entry));
      }
    }
  }

  function typed() {
    selected = 0;
  }

  function closed() {
    query = "";
    selected = 0;
  }
</script>

{#snippet marked(text: string)}
  {#each pieces(text) as piece, at (at)}
    {#if piece.isHit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
  {/each}
{/snippet}

<dialog
  bind:this={dialog}
  class="search-dialog"
  aria-label="Search the docs"
  closedby="any"
  onclose={closed}
  {@attach lightDismiss}
>
  <div class="search-bar">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="search-input"
      type="search"
      placeholder="Search the docs"
      aria-label="Search the docs"
      aria-controls="search-results"
      aria-activedescendant={results.length > 0
        ? `search-${selected}`
        : undefined}
      role="combobox"
      aria-expanded={results.length > 0}
      autofocus
      autocomplete="off"
      spellcheck="false"
      bind:value={query}
      oninput={typed}
      onkeydown={moved}
    />
    <form method="dialog">
      <button type="submit" class="tool search-close" aria-label="Close search">
        <kbd>Esc</kbd>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </form>
  </div>
  {#if status === "failed"}
    <div class="search-note">
      <p>The search index didn't load. Check your connection and try again.</p>
      <button type="button" class="tool" onclick={fetchIndex}>Try again</button>
    </div>
  {:else if entries == null}
    <p class="search-note">Loading the index...</p>
  {:else if tokens(query).length === 0}
    <p class="search-note">Type a word or two to search every page.</p>
  {:else if results.length === 0}
    <p class="search-note">
      Nothing matches “{query}”. Try fewer or shorter words.
    </p>
  {:else}
    <ul id="search-results" class="search-results" role="listbox">
      {#each results as entry, at (`${entry.slug}#${entry.id}`)}
        <li id={`search-${at}`} role="option" aria-selected={at === selected}>
          <a
            href={hrefOf(entry)}
            tabindex="-1"
            onclick={() => dialog?.close()}
            onpointermove={() => (selected = at)}
          >
            {#if entry.heading != null}
              <small>{entry.page}</small>
              <strong>{@render marked(entry.heading)}</strong>
            {:else}
              <strong>{@render marked(entry.page)}</strong>
            {/if}
            <p>{@render marked(snippet(entry))}</p>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</dialog>
