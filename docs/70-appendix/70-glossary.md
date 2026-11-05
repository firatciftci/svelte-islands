---
title: Glossary
---

## Part

A value from `load` that travels outside your page's data, at its own URL named by a hash of its contents. You make one with [`part`](../20-core-concepts/10-parts.md).

## Island

A region of your page that loads and hydrates on its own, using [`Island`](../20-core-concepts/20-islands.md).

## Wake

What an island does when its [`when` strategy](../20-core-concepts/30-when-islands-wake.md) fires: the browser downloads its part and hydrates it.

## Static island

An island whose HTML is in your page from the start, and which runs no code until it wakes. This is the [default](../20-core-concepts/20-islands.md#static).

## Deferred island

An island whose HTML is stored at its own URL and arrives as the island nears the viewport. You get one by [adding `defer`](../20-core-concepts/20-islands.md#deferred).

## Client-only island

An island with no server HTML in your page, which renders in the browser. You get one with [`ssr={false}`](../20-core-concepts/20-islands.md#client-only).

## Skeleton

What an island shows while it waits for its content. The library [learns each one](../20-core-concepts/40-skeletons.md) from what the island rendered.

## Outline

A visually hidden copy of a deferred or client-only island's headings, so that [screen readers](../20-core-concepts/20-islands.md#screen-readers) can reach it before it loads.

## Rebuild

Rerunning a page on the server to make a part it no longer has. These are [limited](../40-build-and-deploy/10-node-servers.md#rebuilds), so that a burst of them can't overload your server.

## Store

A shared cache for parts, deferred HTML, and skeletons. With a [store](../40-build-and-deploy/20-stores.md), a server can read what another server made.
