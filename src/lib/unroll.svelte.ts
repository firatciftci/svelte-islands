import type { Attachment } from "svelte/attachments";
import { flushSync } from "svelte";
import { shape } from "./skeleton.js";

const BUDGET = 8;

export const unroll = (initial: number) => {
  let limit = $state(initial);
  let size = 16;
  return {
    get limit() {
      return limit;
    },
    tail(total: number): Attachment<HTMLElement> {
      return (node) => {
        const model = node.previousElementSibling;
        if (model != null && node.childElementCount === 0) {
          node.className ||= model.className;
          node.innerHTML = shape(model) ?? "";
        }
        node.classList.add("island-skeleton");
        node.setAttribute("aria-hidden", "true");
        let isNear = false;
        let frame: number | null = null;
        const grow = () => {
          frame = null;
          if (!isNear || limit >= total) {
            return;
          }
          const started = performance.now();
          limit = Math.min(total, limit + size);
          flushSync();
          const spent = performance.now() - started;
          size = Math.round(
            Math.min(
              Math.max((size * BUDGET) / Math.max(spent, 1), 4),
              size * 2,
            ),
          );
          frame = requestAnimationFrame(grow);
        };
        const observer = new IntersectionObserver(
          ([entry]) => {
            isNear = entry?.isIntersecting ?? false;
            if (isNear && frame == null) {
              frame = requestAnimationFrame(grow);
            }
          },
          { rootMargin: "100% 0px" },
        );
        observer.observe(node);
        return () => {
          observer.disconnect();
          if (frame != null) {
            cancelAnimationFrame(frame);
          }
        };
      };
    },
  };
};
