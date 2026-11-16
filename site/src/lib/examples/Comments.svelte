<script lang="ts">
  import { Island, type Part } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import CommentList from "#lib/components/CommentList.svelte";
  import type { Comment } from "#lib/harrow.js";

  let { parts }: { parts: { count: number; comments: Part<Array<Comment>> } } =
    $props();
</script>

<Coast>
  <p class="coast-note">
    The comments are in the page as HTML, but their data and code wait for your
    pointer. Try liking one before it wakes.
  </p>
  <h3 class="comments-title">{parts.count} comments</h3>
  <div class="comments-scroll">
    <Island part={parts.comments}>
      {#snippet children(comments)}
        <CommentList {comments} />
      {/snippet}
    </Island>
  </div>
</Coast>
