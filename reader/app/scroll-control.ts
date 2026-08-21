export const MIN_SCROLL_THUMB_SIZE = 20;

export type ScrollbarMetrics = {
  scrollRange: number;
  thumbSize: number;
  thumbTop: number;
  thumbTravel: number;
};

export type MinimapPreviewMetrics = ScrollbarMetrics & {
  contentSize: number;
  contentOffset: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function getScrollbarMetrics(
  trackSize: number,
  viewportSize: number,
  scrollSize: number,
  scrollPosition: number,
  minimumThumbSize = MIN_SCROLL_THUMB_SIZE,
): ScrollbarMetrics {
  const safeTrackSize = Math.max(0, trackSize);
  const safeScrollSize = Math.max(0, scrollSize);
  const safeViewportSize = clamp(viewportSize, 0, safeScrollSize || viewportSize);
  const scrollRange = Math.max(0, safeScrollSize - safeViewportSize);

  if (safeTrackSize === 0) {
    return { scrollRange, thumbSize: 0, thumbTop: 0, thumbTravel: 0 };
  }

  if (scrollRange === 0 || safeScrollSize === 0) {
    return { scrollRange: 0, thumbSize: safeTrackSize, thumbTop: 0, thumbTravel: 0 };
  }

  const proportionalSize = Math.floor(safeTrackSize * safeViewportSize / safeScrollSize);
  const thumbSize = Math.min(safeTrackSize, Math.max(minimumThumbSize, proportionalSize));
  const thumbTravel = Math.max(0, safeTrackSize - thumbSize);
  const progress = clamp(scrollPosition / scrollRange, 0, 1);

  return {
    scrollRange,
    thumbSize,
    thumbTop: progress * thumbTravel,
    thumbTravel,
  };
}

export function getScrollbarVisualMetrics(
  trackSize: number,
  viewportRatio: number,
  progress: number,
  minimumThumbSize = MIN_SCROLL_THUMB_SIZE,
) {
  const safeViewportRatio = clamp(viewportRatio, 0, 1);
  return getScrollbarMetrics(
    trackSize,
    safeViewportRatio,
    1,
    clamp(progress, 0, 1) * Math.max(0, 1 - safeViewportRatio),
    minimumThumbSize,
  );
}

export function getMinimapPreviewMetrics(
  trackSize: number,
  viewportSize: number,
  scrollSize: number,
  scrollPosition: number,
  previewScale: number,
): MinimapPreviewMetrics {
  const safeTrackSize = Math.max(0, trackSize);
  const safeScrollSize = Math.max(0, scrollSize);
  const safeViewportSize = clamp(viewportSize, 0, safeScrollSize || viewportSize);
  const safeScale = Math.max(0, previewScale);
  const scrollRange = Math.max(0, safeScrollSize - safeViewportSize);
  const contentSize = safeScrollSize * safeScale;
  const thumbSize = Math.min(safeTrackSize, safeViewportSize * safeScale);
  const contentTravel = Math.max(0, contentSize - thumbSize);
  const thumbTravel = Math.min(Math.max(0, safeTrackSize - thumbSize), contentTravel);
  const progress = scrollRange > 0 ? clamp(scrollPosition / scrollRange, 0, 1) : 0;
  const thumbTop = progress * thumbTravel;
  const unclampedOffset = thumbTop - clamp(scrollPosition, 0, scrollRange) * safeScale;
  const contentOffset = clamp(unclampedOffset, Math.min(0, safeTrackSize - contentSize), 0);

  return {
    scrollRange,
    thumbSize,
    thumbTop,
    thumbTravel,
    contentSize,
    contentOffset,
  };
}

export function getScrollPositionForPointer(
  pointerOffset: number,
  grabOffset: number,
  metrics: ScrollbarMetrics,
) {
  if (metrics.scrollRange === 0 || metrics.thumbTravel === 0) return 0;
  const thumbTop = clamp(pointerOffset - grabOffset, 0, metrics.thumbTravel);
  return thumbTop / metrics.thumbTravel * metrics.scrollRange;
}
