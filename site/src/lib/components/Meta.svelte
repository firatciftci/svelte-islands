<script lang="ts">
  import { SITE_URL } from "#lib/site.js";

  let {
    title,
    description,
    path,
    type = "article",
  }: {
    title: string;
    description: string;
    path: string;
    type?: "article" | "website";
  } = $props();

  const url = $derived(`${SITE_URL}${path}`);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />
  <meta property="og:site_name" content="svelte-islands" />
  <meta property="og:type" content={type} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:image" content={`${SITE_URL}/card.png`} />
  <meta property="og:image:width" content="2400" />
  <meta property="og:image:height" content="1260" />
  <meta
    property="og:image:alt"
    content="The svelte-islands home page: a sea chart with the library's name on open water, beside an island that holds a table of wards."
  />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>
