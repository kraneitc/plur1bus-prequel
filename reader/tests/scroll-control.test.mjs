import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getMinimapPreviewMetrics,
  getScrollbarMetrics,
  getScrollbarVisualMetrics,
  getScrollPositionForPointer,
} from "../app/scroll-control.ts";

test("sizes and positions the thumb from the visible share of the document", () => {
  const metrics = getScrollbarMetrics(800, 200, 1000, 400);
  assert.deepEqual(metrics, {
    scrollRange: 800,
    thumbSize: 160,
    thumbTop: 320,
    thumbTravel: 640,
  });
});

test("keeps very long documents grabbable", () => {
  const metrics = getScrollbarMetrics(500, 10, 10000, 0);
  assert.equal(metrics.thumbSize, 20);
  assert.equal(metrics.thumbTop, 0);
});

test("centers the thumb on a track press and clamps at both ends", () => {
  const metrics = getScrollbarMetrics(800, 200, 1000, 0);
  const grabOffset = metrics.thumbSize / 2;
  assert.equal(getScrollPositionForPointer(600, grabOffset, metrics), 650);
  assert.equal(getScrollPositionForPointer(-200, grabOffset, metrics), 0);
  assert.equal(getScrollPositionForPointer(1200, grabOffset, metrics), 800);
});

test("preserves the pointer's grab offset while dragging", () => {
  const metrics = getScrollbarMetrics(800, 200, 1000, 400);
  const grabOffset = 30;
  const pointerAfterMoving = metrics.thumbTop + grabOffset + 100;
  assert.equal(getScrollPositionForPointer(pointerAfterMoving, grabOffset, metrics), 525);
});

test("produces the same geometry from render-friendly ratios", () => {
  const metrics = getScrollbarVisualMetrics(800, .2, .5);
  assert.equal(metrics.thumbSize, 160);
  assert.equal(metrics.thumbTop, 320);
});

test("keeps the minimap viewport height stable as the document grows", () => {
  const shortDocument = getMinimapPreviewMetrics(500, 800, 4000, 0, .08);
  const longDocument = getMinimapPreviewMetrics(500, 800, 40000, 0, .08);

  assert.equal(shortDocument.thumbSize, 64);
  assert.equal(longDocument.thumbSize, 64);
});

test("leaves a fitting preview still while the viewport crosses it", () => {
  const metrics = getMinimapPreviewMetrics(500, 200, 1000, 400, .1);

  assert.equal(metrics.contentSize, 100);
  assert.equal(metrics.thumbSize, 20);
  assert.equal(metrics.thumbTop, 40);
  assert.equal(metrics.contentOffset, 0);
});

test("pans an overflowing preview on a different travel range", () => {
  const middle = getMinimapPreviewMetrics(500, 200, 10000, 4900, .1);
  const end = getMinimapPreviewMetrics(500, 200, 10000, 9800, .1);

  assert.equal(middle.thumbSize, 20);
  assert.equal(middle.thumbTop, 240);
  assert.equal(middle.contentOffset, -250);
  assert.equal(end.thumbTop, 480);
  assert.equal(end.contentOffset, -500);
});

test("keeps direct dragging free of smooth-scroll tweening", async () => {
  const [css, minimap] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.reading-pane\s*\{[^}]*scroll-behavior:\s*auto/);
  assert.match(minimap, /reader\.scrollTop\s*=\s*getScrollPositionForPointer/);
});

test("keeps layout measurement and React commits out of pointer movement", async () => {
  const [page, minimap] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
  ]);
  const start = minimap.indexOf("const moveDrag");
  const end = minimap.indexOf("const endDrag");
  const handler = minimap.slice(start, end);

  assert.match(handler, /drag\.metrics/);
  assert.match(handler, /drag\.trackTop/);
  assert.doesNotMatch(handler, /getBoundingClientRect|getMinimapScale|clientHeight|scrollHeight/);
  assert.match(page, /if \(minimapRef\.current\?\.isDragging\(\)\) return;/);
});

test("keeps the minimap implementation outside the reader page", async () => {
  const [page, minimap] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<ReaderMinimap\b/);
  assert.doesNotMatch(page, /className="minimap"/);
  assert.match(minimap, /className="minimap"/);
  assert.match(minimap, /onPointerDown=\{beginDrag\}/);
});
