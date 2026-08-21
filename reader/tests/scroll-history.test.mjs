import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_SCROLL_HISTORY,
  createEmptyScrollHistory,
  isMeaningfulScrollJump,
  readScrollHistory,
  recordScrollNavigation,
  stepScrollHistoryBack,
  stepScrollHistoryForward,
} from "../app/scroll-history.ts";

const point = (scrollTop) => ({ anchor: `part:${scrollTop}`, anchorOffset: .25, progress: scrollTop / 10000, scrollTop });

test("records only a bounded stack and clears forward history", () => {
  let history = { back: [], forward: [point(900)] };
  for (let index = 0; index < MAX_SCROLL_HISTORY + 5; index += 1) {
    history = recordScrollNavigation(history, point(index * 100));
  }

  assert.equal(history.back.length, MAX_SCROLL_HISTORY);
  assert.equal(history.back[0].scrollTop, 500);
  assert.deepEqual(history.forward, []);
});

test("moves backward and forward without creating a loop", () => {
  let history = createEmptyScrollHistory();
  history = recordScrollNavigation(history, point(100));
  history = recordScrollNavigation(history, point(500));

  const backward = stepScrollHistoryBack(history, point(900));
  assert.equal(backward.target.scrollTop, 500);
  assert.equal(backward.history.forward.at(-1).scrollTop, 900);

  const forward = stepScrollHistoryForward(backward.history, point(500));
  assert.equal(forward.target.scrollTop, 900);
  assert.equal(forward.history.back.at(-1).scrollTop, 500);
});

test("ignores ordinary reading movement below half a viewport", () => {
  assert.equal(isMeaningfulScrollJump(1000, 1300, 800), false);
  assert.equal(isMeaningfulScrollJump(1000, 1400, 800), true);
});

test("recovers safely from malformed session history", () => {
  assert.deepEqual(readScrollHistory("not-json"), createEmptyScrollHistory());
  assert.deepEqual(readScrollHistory(JSON.stringify({ back: [{ anchor: 4 }], forward: [] })), createEmptyScrollHistory());
});

test("keeps reading-position history keyboard-only", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /event\.key\.toLowerCase\(\) !== "z"/);
  assert.doesNotMatch(page, /history-actions|history-button|scroll-undo/);
  assert.doesNotMatch(css, /history-actions|history-button|scroll-undo/);
});
