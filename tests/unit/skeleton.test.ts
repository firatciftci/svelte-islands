import { describe, expect, it } from "vitest";
import { outline, skeletonize } from "#lib/skeleton.js";

describe("skeletonize", () => {
  const secret = "s3cret";

  it("keeps the structure and drops the text", () => {
    const shaped = skeletonize(
      `<table class="grid"><tr><th colspan="2">${secret}</th></tr><tr><td>${secret}</td><td>${secret}</td></tr></table>`,
    );
    expect(shaped).toContain('class="grid"');
    expect(shaped).toContain('colspan="2"');
    expect(shaped).not.toContain(secret);
  });

  it.each([
    ["text", `<p>${secret}</p>`],
    ["a title", `<a title="${secret}" href="/${secret}">x</a>`],
    ["an aria label", `<div aria-label="${secret}">x</div>`],
    ["a data attribute", `<div data-user="${secret}">x</div>`],
    ["a value", `<input value="${secret}">`],
    ["an image source", `<img src="/${secret}.png" alt="${secret}">`],
    ["an id", `<div id="${secret}">x</div>`],
    ["a script", `<script>${secret}</script>`],
    ["a style block", `<style>.${secret}{}</style>`],
    ["a comment", `<!-- ${secret} --><div>x</div>`],
    ["a template", `<template>${secret}</template>`],
    ["an event handler", `<div onclick="${secret}()">x</div>`],
    [
      "a background image",
      `<div style="background:url(/${secret}.png)">x</div>`,
    ],
    ["a mask image", `<div style="mask:url(/${secret}.png)">x</div>`],
    ["an image set", `<div style="--pic:url(/${secret}.png)">x</div>`],
    ["a data URL", `<div style="--pic:url(data:a;b:${secret})">x</div>`],
    ["a quoted value", `<div style="--name:'${secret}'">x</div>`],
    ["a quoted semicolon", `<div style='--name:"a;b:${secret}"'>x</div>`],
    ["svg text", `<svg viewBox="0 0 1 1"><text>${secret}</text></svg>`],
    ["svg title", `<svg viewBox="0 0 1 1"><title>${secret}</title></svg>`],
  ])("never carries %s", (_, html) => {
    expect(skeletonize(`<div>${html}</div>`) ?? "").not.toContain(secret);
  });

  it("keeps the sizes that hold the layout", () => {
    const shaped = skeletonize(
      '<div style="inline-size:40%;--bar:42%;background:url(/x.png)">x</div>',
    );
    expect(shaped).toContain("inline-size:40%");
    expect(shaped).toContain("--bar:42%");
    expect(shaped).not.toContain("url(");
  });

  it("gives nothing for empty markup", () => {
    expect(skeletonize("") ?? "").toBe("");
  });

  it("holds the room of the table rows it leaves out", () => {
    const shaped = skeletonize(
      `<table><tbody>${"<tr><td>a</td></tr>".repeat(40)}</tbody></table>`,
    );
    expect(shaped?.match(/<tr>/gu)).toHaveLength(12);
    expect(shaped).toContain(
      '<tr class="island-rest" style="--island-rest:28"><td></td></tr>',
    );
  });

  it("adds no spacer when every row fits", () => {
    const shaped = skeletonize(
      `<table><tbody>${"<tr><td>a</td></tr>".repeat(12)}</tbody></table>`,
    );
    expect(shaped).not.toContain("island-rest");
  });

  it("adds no spacer for other repeated elements", () => {
    const shaped = skeletonize(`<ul>${"<li>a</li>".repeat(40)}</ul>`);
    expect(shaped).not.toContain("island-rest");
  });

  it("stays within its size budget", () => {
    const shaped = skeletonize(
      `<ul>${"<li><b>a</b><i>b</i></li>".repeat(5000)}</ul>`,
    );
    expect(shaped == null || shaped.length <= 24 * 1024).toBe(true);
  });

  it("tolerates broken markup", () => {
    expect(() =>
      skeletonize("<div><p>open <b>tags <<>> </div></span>"),
    ).not.toThrow();
  });
});

describe("outline", () => {
  it("keeps headings for assistive technology", () => {
    const found = outline(
      "<section><h2>Results</h2><p>long text</p></section>",
    );
    expect(found).toContain("Results");
    expect(found).not.toContain("long text");
  });

  it("gives nothing when there are no headings", () => {
    expect(outline("<p>text</p>")).toBe("");
  });
});
