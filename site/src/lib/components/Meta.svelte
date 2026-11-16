<script lang="ts">
  import { SITE_URL } from "#lib/site.js";

  let {
    title,
    description,
    path,
    card,
    cardAlt,
    section,
  }: {
    title: string;
    description: string;
    path: string;
    card: string;
    cardAlt: string;
    section?: string;
  } = $props();

  const url = $derived(`${SITE_URL}${path}`);
  const image = $derived(`${SITE_URL}/cards/${card}.png`);
  const site = {
    "@type": "WebSite",
    name: "svelte-islands",
    url: `${SITE_URL}/`,
  };
  const graph = $derived(
    section == null
      ? [
          site,
          {
            "@type": "SoftwareSourceCode",
            name: "svelte-islands",
            description,
            url,
            image,
            codeRepository: "https://github.com/firatciftci/svelte-islands",
            programmingLanguage: ["TypeScript", "Svelte"],
            runtimePlatform: "SvelteKit",
            license: "https://opensource.org/licenses/MIT",
          },
        ]
      : [
          {
            "@type": "TechArticle",
            headline: title,
            description,
            url,
            image,
            articleSection: section,
            inLanguage: "en-US",
            isPartOf: site,
          },
        ],
  );
  const structured = $derived(
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph,
    }).replaceAll("<", "\\u003c")}<\/script>`,
  );
</script>

<svelte:head>
  <title>{section == null ? title : `${title} • svelte-islands Docs`}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />
  <meta property="og:site_name" content="svelte-islands" />
  <meta property="og:type" content={section == null ? "website" : "article"} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content={image} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="2400" />
  <meta property="og:image:height" content="1260" />
  <meta property="og:image:alt" content={cardAlt} />
  {#if section != null}
    <meta property="article:section" content={section} />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  {@html structured}
</svelte:head>
