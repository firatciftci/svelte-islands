<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { Comment } from "#lib/harrow.js";

  let { comments }: { comments: Array<Comment> } = $props();

  const liked = new SvelteSet<number>();

  function ago(hours: number) {
    return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
  }

  function toggle(id: number) {
    if (liked.has(id)) {
      liked.delete(id);
    } else {
      liked.add(id);
    }
  }
</script>

<ol class="comments">
  {#each comments as comment (comment.id)}
    <li class="comment">
      <p class="comment-meta">
        <strong>{comment.author}</strong>
        <span>{ago(comment.hours)}</span>
      </p>
      <p class="comment-text">{comment.text}</p>
      <button
        type="button"
        class="comment-like"
        aria-pressed={liked.has(comment.id)}
        onclick={() => toggle(comment.id)}
      >
        Like <span>{comment.likes + (liked.has(comment.id) ? 1 : 0)}</span>
      </button>
    </li>
  {/each}
</ol>
