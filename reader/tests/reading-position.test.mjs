import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReadingLocation, readReadingLocation } from "../app/reading-position.ts";

const point = { anchor: "part-2:section:3", anchorOffset: .35, progress: .42, scrollTop: 1240 };

test("round-trips an anchored reading location", () => {
  const location = createReadingLocation("part-2", 1, point, 12345);
  assert.deepEqual(readReadingLocation(JSON.stringify(location)), location);
});

test("clamps persisted progress and scroll position", () => {
  const location = createReadingLocation("part-2", 1, { ...point, progress: 4, scrollTop: -20 }, 12345);
  assert.equal(location.point.progress, 1);
  assert.equal(location.point.scrollTop, 0);
});

test("rejects malformed or unsupported saved locations", () => {
  assert.equal(readReadingLocation("not-json"), null);
  assert.equal(readReadingLocation(JSON.stringify({ version: 2, partId: "part-2", partIndex: 1, point, updatedAt: 12345 })), null);
  assert.equal(readReadingLocation(JSON.stringify({ version: 1, partId: "part-2", partIndex: -1, point, updatedAt: 12345 })), null);
});

test("keeps the manual bookmark separate from resume progress and exposes it throughout the reader", async () => {
  const [page, minimap, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader-minimap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const commitStart = page.indexOf("const commitPosition");
  const commitEnd = page.indexOf("\n\n  useEffect", commitStart);
  assert.match(page, /bookmarkLocationKey\(book\)/);
  assert.match(page, /setSessionBookmark\(location\)/);
  assert.doesNotMatch(page.slice(commitStart, commitEnd), /setSessionBookmark/);
  assert.doesNotMatch(page, /nextSessionBookmarkRef|beginNextSession/);
  assert.match(page, /addEventListener\("pagehide", saveStop\)/);
  assert.match(page, /document\.visibilityState === "hidden"/);
  assert.match(page, /getScrollTarget\(reader, sessionBookmark\.point\) - bookmarkReturnInset/);
  assert.match(page, /className=\{`bookmark-action/);
  assert.match(page, /className="status-bookmark"/);
  assert.match(page, /className="reading-bookmark"/);
  assert.match(minimap, /className="map-bookmark"/);
  assert.match(minimap, /bookmarkProgress/);
  assert.match(css, /\.map-bookmark\s*\{/);
  assert.match(css, /\.bookmark-action-icon\s*\{/);
  assert.match(css, /\.reading-bookmark\s*\{/);
  assert.match(css, /\.status-bookmark\s*\{/);
});
