import { describe, expect, it } from "vitest";
import { shape, skeletonize } from "#lib/skeleton.js";

function elementOf(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

const TABLE = `<table><thead><tr><th>Harbor</th><th>Departures</th></tr></thead><tbody>${Array.from(
  { length: 400 },
  (_, at) => `<tr><td>Harbor ${at}</td><td>${at * 3}</td></tr>`,
).join("")}</tbody></table>`;

const ESSAY = Array.from(
  { length: 900 },
  (_, at) =>
    `<p class="note-${at}">Paragraph ${at} of a long essay, with a <a href="/n/${at}">link</a> in it.</p>`,
).join("");

describe("shape", () => {
  it("draws the live DOM the way the server draws the same HTML", () => {
    for (const html of [
      TABLE,
      `<section><h2>Reviews</h2><img src="/a.png" width="40" height="20"><p>Good</p><p></p></section>`,
      "",
    ]) {
      expect(shape(elementOf(html))).toBe(skeletonize(html));
    }
  });

  it("collapses repeated rows into one row that counts the rest", () => {
    expect(shape(elementOf(TABLE))).toContain(
      'class="island-rest" style="--island-rest:388"',
    );
  });

  it("gives up on content that's too big to draw at any limit", () => {
    expect(shape(elementOf(ESSAY))).toBeNull();
    expect(skeletonize(ESSAY)).toBeNull();
  });
});
