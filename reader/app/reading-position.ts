import type { ScrollPoint } from "./scroll-history";

export type ReadingLocation = {
  version: 1;
  partId: string;
  partIndex: number;
  point: ScrollPoint;
  updatedAt: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createReadingLocation(partId: string, partIndex: number, point: ScrollPoint, updatedAt = Date.now()): ReadingLocation {
  return {
    version: 1,
    partId,
    partIndex: Math.max(0, Math.trunc(partIndex)),
    point: {
      anchor: point.anchor,
      anchorOffset: point.anchorOffset,
      progress: clamp(point.progress, 0, 1),
      scrollTop: Math.max(0, point.scrollTop),
    },
    updatedAt,
  };
}

export function readReadingLocation(serialized: string | null): ReadingLocation | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<ReadingLocation>;
    const point = value.point as Partial<ScrollPoint> | undefined;
    if (value.version !== 1
      || typeof value.partId !== "string" || value.partId.length === 0
      || typeof value.partIndex !== "number" || !Number.isInteger(value.partIndex) || value.partIndex < 0
      || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)
      || !point
      || (point.anchor !== null && typeof point.anchor !== "string")
      || typeof point.anchorOffset !== "number" || !Number.isFinite(point.anchorOffset)
      || typeof point.progress !== "number" || !Number.isFinite(point.progress)
      || typeof point.scrollTop !== "number" || !Number.isFinite(point.scrollTop)) return null;

    return createReadingLocation(value.partId, value.partIndex, {
      anchor: point.anchor,
      anchorOffset: point.anchorOffset,
      progress: point.progress,
      scrollTop: point.scrollTop,
    }, value.updatedAt);
  } catch {
    return null;
  }
}
