export const MAX_SCROLL_HISTORY = 20;
export const MEANINGFUL_JUMP_VIEWPORTS = .5;

export type ScrollPoint = {
  anchor: string | null;
  anchorOffset: number;
  progress: number;
  scrollTop: number;
};

export type ScrollHistory = {
  back: ScrollPoint[];
  forward: ScrollPoint[];
};

export type ScrollHistoryStep = {
  history: ScrollHistory;
  target: ScrollPoint | null;
};

export function createEmptyScrollHistory(): ScrollHistory {
  return { back: [], forward: [] };
}

function isScrollPoint(value: unknown): value is ScrollPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<ScrollPoint>;
  return (point.anchor === null || typeof point.anchor === "string")
    && typeof point.anchorOffset === "number" && Number.isFinite(point.anchorOffset)
    && typeof point.progress === "number" && Number.isFinite(point.progress)
    && typeof point.scrollTop === "number" && Number.isFinite(point.scrollTop);
}

function appendPoint(points: ScrollPoint[], point: ScrollPoint) {
  const last = points.at(-1);
  if (last && last.anchor === point.anchor && Math.abs(last.anchorOffset - point.anchorOffset) < .01) return points;
  return [...points, point].slice(-MAX_SCROLL_HISTORY);
}

export function readScrollHistory(serialized: string | null): ScrollHistory {
  if (!serialized) return createEmptyScrollHistory();
  try {
    const parsed = JSON.parse(serialized) as Partial<ScrollHistory>;
    return {
      back: Array.isArray(parsed.back) ? parsed.back.filter(isScrollPoint).slice(-MAX_SCROLL_HISTORY) : [],
      forward: Array.isArray(parsed.forward) ? parsed.forward.filter(isScrollPoint).slice(-MAX_SCROLL_HISTORY) : [],
    };
  } catch {
    return createEmptyScrollHistory();
  }
}

export function isMeaningfulScrollJump(origin: number, destination: number, viewportSize: number) {
  return Math.abs(destination - origin) >= Math.max(1, viewportSize * MEANINGFUL_JUMP_VIEWPORTS);
}

export function recordScrollNavigation(history: ScrollHistory, origin: ScrollPoint): ScrollHistory {
  return { back: appendPoint(history.back, origin), forward: [] };
}

export function stepScrollHistoryBack(history: ScrollHistory, current: ScrollPoint): ScrollHistoryStep {
  const target = history.back.at(-1) ?? null;
  if (!target) return { history, target: null };
  return {
    history: { back: history.back.slice(0, -1), forward: appendPoint(history.forward, current) },
    target,
  };
}

export function stepScrollHistoryForward(history: ScrollHistory, current: ScrollPoint): ScrollHistoryStep {
  const target = history.forward.at(-1) ?? null;
  if (!target) return { history, target: null };
  return {
    history: { back: appendPoint(history.back, current), forward: history.forward.slice(0, -1) },
    target,
  };
}
