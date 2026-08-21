import type { BookPart } from "./formats";

export type BookProgressMap = {
  weights: number[];
  starts: number[];
  total: number;
  boundaries: number[];
};

const plainTextLength = (html: string) => html
  .replace(/<[^>]*>/g, " ")
  .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "x")
  .replace(/\s+/g, " ")
  .trim().length;

export function createBookProgressMap(parts: BookPart[]): BookProgressMap {
  const weights = parts.map((part) => Math.max(1, 240 + part.blocks.reduce((total, block) => total + (block.type === "break" ? 180 : Math.max(48, plainTextLength(block.html))), 0)));
  const starts: number[] = [];
  let total = 0;
  weights.forEach((weight) => { starts.push(total); total += weight; });
  return {
    weights,
    starts,
    total: Math.max(1, total),
    boundaries: starts.slice(1).map((start) => start / Math.max(1, total)),
  };
}

export function getOverallBookProgress(map: BookProgressMap, partIndex: number, partProgress: number) {
  if (map.weights.length === 0) return 0;
  const index = Math.max(0, Math.min(map.weights.length - 1, partIndex));
  const local = Math.max(0, Math.min(1, partProgress));
  return (map.starts[index] + map.weights[index] * local) / map.total;
}

export function resolveOverallBookProgress(map: BookProgressMap, overallProgress: number) {
  if (map.weights.length === 0) return { partIndex: 0, partProgress: 0 };
  const progress = Math.max(0, Math.min(1, overallProgress));
  const position = progress * map.total;
  let partIndex = map.weights.length - 1;
  for (let index = 0; index < map.weights.length; index += 1) {
    if (position < map.starts[index] + map.weights[index] || index === map.weights.length - 1) {
      partIndex = index;
      break;
    }
  }
  const partProgress = (position - map.starts[partIndex]) / map.weights[partIndex];
  return { partIndex, partProgress: Math.max(0, Math.min(1, partProgress)) };
}
