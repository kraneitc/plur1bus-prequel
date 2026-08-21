import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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

test("keeps direct dragging free of smooth-scroll tweening", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.reading-pane\s*\{[^}]*scroll-behavior:\s*auto/);
  assert.match(page, /reader\.scrollTop\s*=\s*getScrollPositionForPointer/);
});
