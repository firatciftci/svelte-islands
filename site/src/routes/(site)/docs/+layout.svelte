<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";

  let { data, children } = $props();

  const current = $derived(page.params.slug ?? "");
</script>

{#snippet links()}
  <div class="sidebar-inner">
    {#each data.nav as group (group.title)}
      <section>
        <h2>{group.title}</h2>
        <ul>
          {#each group.pages as item (item.slug)}
            <li>
              <a
                href={resolve("/(site)/docs/[...slug]", { slug: item.slug })}
                aria-current={item.slug === current ? "page" : undefined}
                >{item.title}</a
              >
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/snippet}

<div class="docs">
  <details class="docs-menu">
    <summary>All pages</summary>
    {@render links()}
  </details>
  <nav class="sidebar" aria-label="Docs">
    {@render links()}
  </nav>
  {@render children()}
</div>
