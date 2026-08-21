"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { ReaderBook } from "./formats";
import { captureScrollPoint, getElementScrollTop, type ScrollPoint } from "./scroll-history";
import { getMinimapPreviewMetrics, getScrollbarMetrics, getScrollPositionForPointer } from "./scroll-control";

const minimapLinePitch = 3;
const minimapScrollbarWidth = 14;
const fallbackReaderLineHeight = 33;
const maximumMinimapItems = 4000;

type MinimapItemKind = "heading" | "paragraph" | "break";

type MinimapItem = {
  key: string;
  kind: MinimapItemKind;
  top: number;
  height: number;
  width: number;
  firstHeading: boolean;
};

function getParagraphWidth(characterCount: number) {
  return Math.max(24, Math.min(96, 24 + Math.sqrt(characterCount) * 4.4));
}

function selectMinimapNodes(nodes: HTMLElement[]) {
  if (nodes.length <= maximumMinimapItems) return nodes;
  const semanticNodes = nodes.filter((node) => node.dataset.minimapKind !== "paragraph");
  const paragraphs = nodes.filter((node) => node.dataset.minimapKind === "paragraph");
  const paragraphBudget = Math.max(1, maximumMinimapItems - semanticNodes.length);
  const selectedParagraphs = new Set(Array.from({ length: paragraphBudget }, (_, index) => paragraphs[Math.floor(index * paragraphs.length / paragraphBudget)]));
  return nodes.filter((node) => node.dataset.minimapKind !== "paragraph" || selectedParagraphs.has(node));
}

export type ReaderGeometry = { trackSize: number; viewportSize: number; scrollSize: number; previewScale: number };

export const defaultReaderGeometry: ReaderGeometry = {
  trackSize: 0,
  viewportSize: 0,
  scrollSize: 0,
  previewScale: minimapLinePitch / fallbackReaderLineHeight,
};

export function getReaderGeometry(reader: HTMLElement, trackSize: number): ReaderGeometry {
  const page = reader.querySelector<HTMLElement>(".page");
  const lineHeight = page ? Number.parseFloat(getComputedStyle(page).lineHeight) : 0;
  return {
    trackSize,
    viewportSize: reader.clientHeight,
    scrollSize: reader.scrollHeight,
    previewScale: minimapLinePitch / (lineHeight || fallbackReaderLineHeight),
  };
}

export type ReaderMinimapHandle = {
  applyPosition: (scrollPosition: number, geometry: ReaderGeometry, reveal?: boolean) => void;
  getTrackSize: () => number;
  isDragging: () => boolean;
};

type ReaderMinimapProps = {
  book: ReaderBook;
  readerRef: RefObject<HTMLElement | null>;
  progress: number;
  geometry: ReaderGeometry;
  onGeometryChange: (geometry: ReaderGeometry) => void;
  onNavigation: (origin: ScrollPoint, destination: number) => void;
  onPositionCommit: () => void;
};

type MinimapDrag = {
  pointerId: number;
  grabOffset: number;
  trackTop: number;
  metrics: ReturnType<typeof getScrollbarMetrics>;
  geometry: ReaderGeometry;
  origin: ScrollPoint;
};

export const ReaderMinimap = forwardRef<ReaderMinimapHandle, ReaderMinimapProps>(function ReaderMinimap({
  book,
  readerRef,
  progress,
  geometry,
  onGeometryChange,
  onNavigation,
  onPositionCommit,
}, forwardedRef) {
  const minimapRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<MinimapDrag | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapItems, setMapItems] = useState<MinimapItem[]>([]);

  const applyPosition = useCallback((scrollPosition: number, nextGeometry: ReaderGeometry, reveal = false) => {
    const previewMetrics = getMinimapPreviewMetrics(nextGeometry.trackSize, nextGeometry.viewportSize, nextGeometry.scrollSize, scrollPosition, nextGeometry.previewScale);
    const scrollbarMetrics = getScrollbarMetrics(nextGeometry.trackSize, nextGeometry.viewportSize, nextGeometry.scrollSize, scrollPosition);
    const range = Math.max(0, nextGeometry.scrollSize - nextGeometry.viewportSize);
    const nextProgress = range > 0 ? Math.max(0, Math.min(1, scrollPosition / range)) : 0;
    const percent = Math.round(nextProgress * 100);

    if (tapeRef.current) {
      tapeRef.current.style.height = `${previewMetrics.contentSize}px`;
      tapeRef.current.style.transform = `translate3d(0, ${previewMetrics.contentOffset}px, 0)`;
    }
    if (viewportRef.current) {
      viewportRef.current.style.top = `${previewMetrics.thumbTop}px`;
      viewportRef.current.style.height = `${previewMetrics.thumbSize}px`;
    }
    if (scrollbarThumbRef.current) {
      scrollbarThumbRef.current.style.top = `${scrollbarMetrics.thumbTop}px`;
      scrollbarThumbRef.current.style.height = `${scrollbarMetrics.thumbSize}px`;
    }
    if (progressRef.current) progressRef.current.textContent = `${percent}%`;
    minimapRef.current?.setAttribute("aria-valuenow", String(percent));
    minimapRef.current?.setAttribute("aria-valuetext", `${percent}% through the book`);

    if (reveal && minimapRef.current) {
      minimapRef.current.dataset.scrolling = "true";
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => {
        if (minimapRef.current) delete minimapRef.current.dataset.scrolling;
      }, 760);
    }
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    applyPosition,
    getTrackSize: () => trackRef.current?.clientHeight ?? 0,
    isDragging: () => dragRef.current !== null,
  }), [applyPosition]);

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const reader = readerRef.current;
      if (!reader || geometry.previewScale <= 0) return;
      const readerTop = reader.getBoundingClientRect().top;
      const nodes = selectMinimapNodes(Array.from(reader.querySelectorAll<HTMLElement>("[data-minimap-kind]")));
      let headingIndex = 0;
      const nextItems = nodes.map((node, index): MinimapItem => {
        const rawKind = node.dataset.minimapKind;
        const kind: MinimapItemKind = rawKind === "heading" || rawKind === "break" ? rawKind : "paragraph";
        const firstHeading = kind === "heading" && headingIndex++ === 0;
        const scaledHeight = node.offsetHeight * geometry.previewScale;
        const height = kind === "heading" ? Math.max(16, Math.min(28, scaledHeight)) : kind === "break" ? Math.max(9, scaledHeight) : Math.max(1, scaledHeight);
        return {
          key: node.dataset.minimapKey ?? node.dataset.scrollAnchor ?? `${kind}:${index}`,
          kind,
          top: Math.max(0, getElementScrollTop(reader, node, readerTop) * geometry.previewScale),
          height,
          width: kind === "paragraph" ? getParagraphWidth(node.textContent?.trim().length ?? 0) : 100,
          firstHeading,
        };
      });
      setMapItems(nextItems);
    });
    return () => cancelAnimationFrame(frame);
  }, [book, geometry.previewScale, geometry.scrollSize, readerRef]);

  const mapItemElements = useMemo(() => mapItems.map((item) => {
    const style = { top: `${item.top}px`, height: `${item.height}px`, width: `${item.width}%` };
    if (item.kind === "heading") return <span className={`map-item map-heading${item.firstHeading ? " first" : ""}`} key={item.key} style={style}><i /><i /><i /></span>;
    if (item.kind === "break") return <span className="map-item map-scene-break" key={item.key} style={style} />;
    return <i className="map-item map-paragraph" key={item.key} style={style} />;
  }), [mapItems]);
  const scrollRange = Math.max(0, geometry.scrollSize - geometry.viewportSize);
  const scrollPosition = progress * scrollRange;
  const previewMetrics = getMinimapPreviewMetrics(geometry.trackSize, geometry.viewportSize, geometry.scrollSize, scrollPosition, geometry.previewScale);
  const scrollbarMetrics = getScrollbarMetrics(geometry.trackSize, geometry.viewportSize, geometry.scrollSize, scrollPosition);
  const viewportStyle = { top: `${previewMetrics.thumbTop}px`, height: `${previewMetrics.thumbSize}px` };
  const tapeStyle = { height: `${previewMetrics.contentSize}px`, transform: `translate3d(0, ${previewMetrics.contentOffset}px, 0)` } as CSSProperties;
  const scrollbarThumbStyle = { top: `${scrollbarMetrics.thumbTop}px`, height: `${scrollbarMetrics.thumbSize}px` };

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const reader = readerRef.current;
    const track = trackRef.current;
    if (!reader || !track) return;

    event.preventDefault();
    const element = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const nextGeometry = getReaderGeometry(reader, rect.height);
    const target = event.clientX >= rect.right - minimapScrollbarWidth ? "scrollbar" : "preview";
    const metrics = target === "scrollbar"
      ? getScrollbarMetrics(nextGeometry.trackSize, nextGeometry.viewportSize, nextGeometry.scrollSize, reader.scrollTop)
      : getMinimapPreviewMetrics(nextGeometry.trackSize, nextGeometry.viewportSize, nextGeometry.scrollSize, reader.scrollTop, nextGeometry.previewScale);
    const pointerOffset = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const withinThumb = pointerOffset >= metrics.thumbTop && pointerOffset <= metrics.thumbTop + metrics.thumbSize;
    const grabOffset = withinThumb ? pointerOffset - metrics.thumbTop : metrics.thumbSize / 2;

    dragRef.current = { pointerId: event.pointerId, grabOffset, trackTop: rect.top, metrics, geometry: nextGeometry, origin: captureScrollPoint(reader) };
    if (!withinThumb) {
      reader.scrollTop = getScrollPositionForPointer(pointerOffset, grabOffset, metrics);
      applyPosition(reader.scrollTop, nextGeometry);
    }
    element.dataset.dragging = "true";
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const reader = readerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !reader) return;

    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const latest = samples.at(-1) ?? event.nativeEvent;
    reader.scrollTop = getScrollPositionForPointer(latest.clientY - drag.trackTop, drag.grabOffset, drag.metrics);
    applyPosition(reader.scrollTop, drag.geometry);
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const reader = readerRef.current;
    if (drag?.pointerId !== event.pointerId || !reader) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onGeometryChange(drag.geometry);
    onNavigation(drag.origin, reader.scrollTop);
    onPositionCommit();
  };

  const handleKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const reader = readerRef.current;
    if (!reader) return;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = reader.scrollTop + 48;
    if (event.key === "ArrowUp") next = reader.scrollTop - 48;
    if (event.key === "PageDown") next = reader.scrollTop + reader.clientHeight * .9;
    if (event.key === "PageUp") next = reader.scrollTop - reader.clientHeight * .9;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = reader.scrollHeight - reader.clientHeight;
    if (next === null) return;
    event.preventDefault();
    if (event.key === "Home" || event.key === "End") onNavigation(captureScrollPoint(reader), next);
    reader.scrollTop = next;
  };

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const reader = readerRef.current;
    if (!reader) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? reader.clientHeight : 1;
    reader.scrollTop += event.deltaY * unit;
  };

  return <div className="minimap" ref={minimapRef} role="scrollbar" aria-label="Book position" aria-controls="book-reading-pane" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-valuetext={`${Math.round(progress * 100)}% through the book`} tabIndex={0}
    onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onWheel={handleWheel} onKeyDown={handleKey}>
    <div className="map-scroll-area" ref={trackRef} aria-hidden="true">
      <div className="map-tape" ref={tapeRef} style={tapeStyle}>{mapItemElements}</div>
      <div className="map-viewport" ref={viewportRef} style={viewportStyle} />
      <div className="map-scrollbar-track" />
      <div className="map-scrollbar-thumb" ref={scrollbarThumbRef} style={scrollbarThumbStyle} />
    </div>
    <span className="map-progress" ref={progressRef}>{Math.round(progress * 100)}%</span>
  </div>;
});
