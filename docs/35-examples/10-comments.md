---
title: Comments under a post
---

A blog post's comments are a good first island. People mostly read them, a long thread can carry more data than the post itself, and only the few readers who reply or press Like need any of it to run.

Your server `load` function returns the post as usual, and wraps the comments in a [part](../20-core-concepts/10-parts.md):

```ts
/// file: src/routes/blog/[slug]/+page.server.ts
import { part } from "svelte-islands/server";

export async function load({ params }) {
  const post = await getPost(params.slug);
  const comments = await getComments(post.id);

  return {
    post,
    commentCount: comments.length,
    comments: part("post.comments", comments),
  };
}
```

You compute `commentCount` here, and not in the browser, because the heading needs it before any comment has downloaded. It is a number, so it costs nothing to send with the page.

## The page

The heading goes outside the island, and the list goes inside it:

```svelte
<!--- file: src/routes/blog/[slug]/+page.svelte --->
<script>
  import { Island } from "svelte-islands";
  import CommentList from "./CommentList.svelte";

  let { data } = $props();
</script>

<article>
  <h1>{data.post.title}</h1>
  {@html data.post.html}
</article>

<section aria-labelledby="comments">
  <h2 id="comments">{data.commentCount} comments</h2>

  <Island part={data.comments}>
    {#snippet children(comments)}
      <CommentList {comments} />
    {/snippet}

    {#snippet failed(retry)}
      <p>
        The comments did not load. <button onclick={retry}>Try again</button>
      </p>
    {/snippet}
  </Island>
</section>
```

Keeping the heading outside means it is always in your page, so a link to `#comments` lands even before the list has loaded, and the heading hydrates with the rest of the page.

The island uses the default strategy, `interaction`. The comments render on the server and their HTML is in the page from the start, but the browser does not download their data, or hydrate the list, until someone points at it or tabs into it. Most readers never do, and they pay nothing for the list beyond its HTML.

## The list

`CommentList` is an ordinary component. Nothing in it knows that it is inside an island:

```svelte
<!--- file: src/routes/blog/[slug]/CommentList.svelte --->
<script>
  import { SvelteSet } from "svelte/reactivity";

  let { comments } = $props();

  const liked = new SvelteSet();

  async function like(id) {
    liked.add(id);
    await fetch(`/api/comments/${id}/like`, { method: "POST" });
  }
</script>

<ol>
  {#each comments as comment (comment.id)}
    <li>
      <p><strong>{comment.author}</strong></p>
      <p>{comment.text}</p>
      <button
        aria-pressed={liked.has(comment.id)}
        disabled={liked.has(comment.id)}
        onclick={() => like(comment.id)}
      >
        Like {comment.likes + (liked.has(comment.id) ? 1 : 0)}
      </button>
    </li>
  {/each}
</ol>
```

The Like button works even if someone presses it before the island has hydrated. The island [holds the click](../20-core-concepts/60-clicks.md), downloads the comments, hydrates, and replays the click, so the press is not lost. Moving a pointer over the list is usually enough to start the download, so by the time the click lands, the data is often already there.

You can try it here. The count sits outside the island, and the thread wakes when you reach for it:

<!-- example: comments -->

## When the comments do not load

The `failed` snippet shows when the island was waiting for its data and the [retries](../20-core-concepts/10-parts.md#when-a-part-goes-missing) ran out. It receives a function that tries again.

On a first page load this island is static, so its HTML is already on screen. If its data cannot load, it keeps showing that HTML, which stays readable, but its Like buttons will not respond. `failed` matters after a client-side navigation, when there is no server HTML to fall back on and the island would otherwise show a skeleton. Without it, you get a plain Retry button.

## Short threads

A post with a handful of comments makes a part of 4,096 characters or less, which [stays in the page](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page). The island then is not a hydration boundary, so the list hydrates with the rest of your page, which for a few comments is what you would want anyway.

You do not need to treat short threads differently. The same code handles both, and the library decides per post.

## Long threads below the post

If the comments usually sit below a long post, you can keep their HTML out of the page as well with [`defer`](../20-core-concepts/20-islands.md#deferred):

```svelte
<Island part={data.comments} defer>
  {#snippet children(comments)}
    <CommentList {comments} />
  {/snippet}
</Island>
```

Your page then holds a [skeleton](../20-core-concepts/40-skeletons.md) learned from earlier renders of the list, and the HTML arrives as the reader scrolls toward it.

This has a trade-off: the comments are not in the first response, so a crawler that does not run JavaScript will not see them. The [outline](../20-core-concepts/20-islands.md#screen-readers) keeps only headings with ids, and comments rarely have any. If you want your comments indexed, leave out `defer`.

A thread with thousands of comments has a second problem: it takes a while to hydrate once someone touches it. [`unroll`](../30-long-content/10-long-lists.md) renders the list a piece at a time, and it works inside an island.

## When to use `visible`

`interaction` suits a list that people read. If the list has to be live as soon as it is on screen (comments that update in real time, for example, or a reply box that should accept typing right away), you should use `when="visible"` instead:

```svelte
<Island part={data.comments} when="visible">
  {#snippet children(comments)}
    <CommentList {comments} />
  {/snippet}
</Island>
```

The download starts 320 pixels before the list scrolls into view, so it is usually ready by the time it gets there.

## Per-visitor details

The comments themselves are the same for everyone, which is why they can be an ordinary part with a public URL. Anything that differs per visitor, such as an Edit button on the reader's own comments, must _not_ go in that part.

You can send it as plain page data instead (a list of the reader's comment ids, say) and read it inside the island. That keeps the public part public. But a deferred island's HTML also gets a public URL, so an island that shows per-visitor controls should not use `defer`. There's more on this in [private data](../60-best-practices/10-private-data.md).

Relative times need care too. A time such as "3 hours ago" can come out differently on the server and in the browser, which makes the island [mismatch when it hydrates](../70-appendix/20-troubleshooting.md#svelte-warns-about-a-hydration-mismatch). You can format times on the server, or render a fixed date in a `<time>` element.
