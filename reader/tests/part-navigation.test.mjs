import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("mounts one part while keeping part and section navigation distinct", async () => {
  const [page, minimap, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /aria-label="Part navigation"/);
  assert.match(page, /aria-label="Previous part"/);
  assert.match(page, /aria-label="Next part"/);
  assert.match(page, /activeSections\.map/);
  assert.match(page, /data-reader-section/);
  assert.match(page, /activePartId=\{activePart\.id\}/);
  assert.match(minimap, /querySelectorAll<HTMLElement>\("\[data-reader-section\]"\)/);
  assert.match(minimap, /aria-label="Previous section"/);
  assert.match(minimap, /aria-label="Next section"/);
  assert.match(css, /\.topbar[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
  assert.match(css, /\.part-navigation[^}]*justify-self:\s*center/);
});
