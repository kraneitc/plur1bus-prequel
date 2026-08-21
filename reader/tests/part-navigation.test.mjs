import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBookProgressMap, getOverallBookProgress, resolveOverallBookProgress, snapOverallBookProgress } from "../app/book-progress.ts";
import { splitPartSections } from "../app/formats.ts";

test("uses scene breaks to divide a part into navigable sections", () => {
  const blocks = [
    { type: "p", html: "First scene." },
    { type: "break", html: "" },
    { type: "p", html: "Second scene." },
    { type: "break", html: "" },
    { type: "p", html: "Third scene." },
  ];

  const sections = splitPartSections(blocks);
  assert.equal(sections.length, 3);
  assert.equal(sections[0][0].html, "First scene.");
  assert.equal(sections[1][0].type, "break");
  assert.equal(sections[2][1].html, "Third scene.");
});

test("keeps a part without scene breaks as one section", () => {
  assert.equal(splitPartSections([{ type: "p", html: "One continuous scene." }]).length, 1);
});

test("maps whole-text progress through content-weighted part boundaries", () => {
  const parts = [
    { id: "short", label: "Part One", title: "Short", blocks: [{ type: "p", html: "Brief." }] },
    { id: "long", label: "Part Two", title: "Long", blocks: [{ type: "p", html: "A much longer section of text ".repeat(40) }] },
  ];
  const map = createBookProgressMap(parts);
  assert.ok(map.boundaries[0] < .5);
  const overall = getOverallBookProgress(map, 1, .4);
  const resolved = resolveOverallBookProgress(map, overall);
  assert.equal(resolved.partIndex, 1);
  assert.ok(Math.abs(resolved.partProgress - .4) < .0001);

  const snapped = snapOverallBookProgress(map, map.boundaries[0] - .02, .03);
  const snappedLocation = resolveOverallBookProgress(map, snapped);
  assert.equal(snapped, map.boundaries[0]);
  assert.deepEqual(snappedLocation, { partIndex: 1, partProgress: 0 });
  assert.equal(snapOverallBookProgress(map, map.boundaries[0] - .04, .03), map.boundaries[0] - .04);
});

test("mounts one part while keeping part and section navigation distinct", async () => {
  const [page, minimap, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /aria-label="Part navigation"/);
  assert.doesNotMatch(page, /className="part-position"[^>]*><b>Part<\/b>/);
  assert.match(page, /className="memory-button"/);
  assert.match(page, /aria-label="What should I remember\?"/);
  assert.match(page, /<span className="memory-spark" aria-hidden="true">✦<\/span><\/button>/);
  assert.match(page, /aria-label="Previous part"/);
  assert.match(page, /aria-label="Next part"/);
  assert.match(page, /activeSections\.map/);
  assert.match(page, /data-reader-section/);
  assert.match(page, /activePartId=\{activePart\.id\}/);
  assert.match(page, /aria-label="Position in the entire text"/);
  assert.match(page, /bookProgressMap\.boundaries\.map/);
  assert.match(page, /part-enter-\$\{partTransitionDirection\}/);
  assert.match(page, /onSectionMovement=\{cueSectionMovement\}/);
  assert.match(minimap, /querySelectorAll<HTMLElement>\("\[data-reader-section\]"\)/);
  assert.match(minimap, /aria-label="Previous section"/);
  assert.match(minimap, /aria-label="Next section"/);
  assert.match(css, /\.topbar[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
  assert.match(css, /\.part-navigation[^}]*justify-self:\s*center/);
  assert.match(css, /\.part-navigation button[^}]*place-items:\s*center/);
  assert.match(css, /\.part-navigation button span[^}]*translate:\s*0 -1px/);
  assert.match(css, /\.page\.part-enter-forward[^}]*240ms cubic-bezier/);
  assert.match(css, /@keyframes part-enter-forward[^}]*translate:\s*36px 0/);
  assert.match(css, /\.page\.section-enter-down[^}]*125ms ease-out/);
  assert.match(css, /@keyframes section-enter-down[^}]*translate:\s*0 12px/);
});
