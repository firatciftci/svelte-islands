import type { Attachment } from "svelte/attachments";
import { flushSync } from "svelte";
import { whenWanted } from "./runtime.js";
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
        let isWanted = false;
        let frame: number | null = null;
        const grow = () => {
          frame = null;
          if (!(isNear || isWanted) || limit >= total) {
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
          (entries) => {
            isNear = entries.at(-1)?.isIntersecting ?? false;
            if (isNear && frame == null) {
              frame = requestAnimationFrame(grow);
            }
          },
          { rootMargin: "0px 0px 100% 0px" },
        );
        observer.observe(node);
        const stopWanting = whenWanted((want) => {
          if (want === "print") {
            limit = total;
            flushSync();
            return;
          }
          isWanted = true;
          frame ??= requestAnimationFrame(grow);
        });
        return () => {
          stopWanting();
          observer.disconnect();
          if (frame != null) {
            cancelAnimationFrame(frame);
          }
        };
      };
    },
  };
};
