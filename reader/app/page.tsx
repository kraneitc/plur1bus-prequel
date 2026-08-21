"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBookProgressMap, getOverallBookProgress, resolveOverallBookProgress, snapOverallBookProgress, type BookProgressMap } from "./book-progress";
import { formatSupport, parseEpub, splitPartSections, type ReaderBook } from "./formats";
import { getRecap } from "./recaps";
import { createReadingLocation, readReadingLocation, type ReadingLocation } from "./reading-position";
import { ReaderMinimap, defaultReaderGeometry, getReaderGeometry, type ReaderGeometry, type ReaderMinimapHandle } from "./reader-minimap";
import {
  captureScrollPoint,
  createEmptyScrollHistory,
  getElementScrollTop,
  isMeaningfulScrollJump,
  readScrollHistory,
  recordScrollNavigation,
  stepScrollHistoryBack,
  stepScrollHistoryForward,
  type ScrollHistory,
  type ScrollPoint,
} from "./scroll-history";

type Preferences = { fontSize: number; lineHeight: number; measure: number };
const defaultPreferences: Preferences = { fontSize: 22, lineHeight: 1.5, measure: 68 };
const builtInKey = "before-we-were-us";
const positionCommitInterval = 80;
const bookmarkReturnInset = 32;
const emptyBookProgressMap = createBookProgressMap([]);

function storageKey(book: ReaderBook) { return `story-reader:${book.title.toLowerCase().replace(/\W+/g, "-")}`; }
function partProgressKey(book: ReaderBook, partId: string) { return `${storageKey(book)}:part:${partId}:progress`; }
function partHistoryKey(book: ReaderBook, partId: string) { return `${storageKey(book)}:part:${partId}:scroll-history`; }
function readingLocationKey(book: ReaderBook) { return `${storageKey(book)}:reading-location`; }
function bookmarkLocationKey(book: ReaderBook) { return `${storageKey(book)}:bookmark-location`; }
function clampProgress(value: number) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function createProgressPoint(progress: number): ScrollPoint { return { anchor: null, anchorOffset: 0, progress: clampProgress(progress), scrollTop: 0 }; }
function writeReadingLocation(book: ReaderBook, location: ReadingLocation) {
  localStorage.setItem(readingLocationKey(book), JSON.stringify(location));
  localStorage.setItem(`${storageKey(book)}:part-index`, String(location.partIndex));
  localStorage.setItem(partProgressKey(book, location.partId), String(location.point.progress));
}
function getScrollTarget(reader: HTMLElement, point: ScrollPoint) {
  const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
  let target = point.progress * range;
  if (point.anchor) {
    const anchor = Array.from(reader.querySelectorAll<HTMLElement>("[data-scroll-anchor]")).find((element) => element.dataset.scrollAnchor === point.anchor);
    if (anchor) target = getElementScrollTop(reader, anchor) + point.anchorOffset * anchor.offsetHeight;
  }
  return Math.max(0, Math.min(range, target));
}

export default function Home() {
  const readerRef = useRef<HTMLElement>(null);
  const minimapRef = useRef<ReaderMinimapHandle>(null);
  const mainBookmarkRef = useRef<HTMLButtonElement>(null);
  const statusProgressRef = useRef<HTMLElement>(null);
  const statusPercentRef = useRef<HTMLSpanElement>(null);
  const readerGeometryRef = useRef<ReaderGeometry>(defaultReaderGeometry);
  const bookProgressMapRef = useRef<BookProgressMap>(emptyBookProgressMap);
  const activePartIndexRef = useRef(0);
  const scrollHistoryRef = useRef<ScrollHistory>(createEmptyScrollHistory());
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPartProgressRef = useRef(0);
  const pendingScrollPointRef = useRef<ScrollPoint | null>(null);
  const pendingScrollInsetRef = useRef(0);
  const pendingWelcomeRef = useRef(false);
  const restoringPositionRef = useRef(false);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [progress, setProgress] = useState(0);
  const [readerGeometry, setReaderGeometry] = useState(defaultReaderGeometry);
  const [partIndex, setPartIndex] = useState(0);
  const [partTransitionDirection, setPartTransitionDirection] = useState<"forward" | "backward" | null>(null);
  const [partProgress, setPartProgress] = useState(0);
  const [sessionBookmark, setSessionBookmark] = useState<ReadingLocation | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [importError, setImportError] = useState("");

  const activePart = book?.parts[partIndex];
  const activeSections = useMemo(() => activePart ? splitPartSections(activePart.blocks) : [], [activePart]);
  const bookProgressMap = useMemo(() => createBookProgressMap(book?.parts ?? []), [book]);
  bookProgressMapRef.current = bookProgressMap;
  activePartIndexRef.current = partIndex;

  const openBook = useCallback((nextBook: ReaderBook) => {
    const key = storageKey(nextBook);
    const storedLocation = readReadingLocation(localStorage.getItem(readingLocationKey(nextBook)));
    const storedPartIndex = storedLocation ? nextBook.parts.findIndex((part) => part.id === storedLocation.partId) : -1;
    const savedLocation = storedLocation && storedPartIndex >= 0
      ? createReadingLocation(storedLocation.partId, storedPartIndex, storedLocation.point, storedLocation.updatedAt)
      : null;
    const storedBookmark = readReadingLocation(localStorage.getItem(bookmarkLocationKey(nextBook)));
    const storedBookmarkPartIndex = storedBookmark ? nextBook.parts.findIndex((part) => part.id === storedBookmark.partId) : -1;
    const savedBookmark = storedBookmark && storedBookmarkPartIndex >= 0
      ? createReadingLocation(storedBookmark.partId, storedBookmarkPartIndex, storedBookmark.point, storedBookmark.updatedAt)
      : null;
    const savedPartValue = localStorage.getItem(`${key}:part-index`);
    const legacyProgress = clampProgress(Number(localStorage.getItem(`${key}:progress`) || 0));
    const nextProgressMap = createBookProgressMap(nextBook.parts);
    const legacyLocation = resolveOverallBookProgress(nextProgressMap, legacyProgress);
    const savedPartIndex = savedLocation?.partIndex ?? (savedPartValue === null
      ? legacyLocation.partIndex
      : Math.max(0, Math.min(nextBook.parts.length - 1, Number(savedPartValue) || 0)));
    const savedPart = nextBook.parts[savedPartIndex];
    const savedPartProgress = savedLocation?.point.progress ?? (savedPartValue === null
      ? legacyLocation.partProgress
      : clampProgress(Number(localStorage.getItem(partProgressKey(nextBook, savedPart.id)) || 0)));
    pendingPartProgressRef.current = savedPartProgress;
    pendingScrollPointRef.current = savedLocation?.point ?? null;
    pendingWelcomeRef.current = savedPartIndex > 0 || savedPartProgress > .004;
    restoringPositionRef.current = true;
    setPartIndex(savedPartIndex);
    setProgress(savedPartProgress);
    setPartProgress(savedPartProgress);
    setSessionBookmark(savedBookmark);
    setBook(nextBook);
  }, []);

  useEffect(() => {
    const savedPrefs = localStorage.getItem("story-reader:preferences");
    if (savedPrefs) setPreferences({ ...defaultPreferences, ...JSON.parse(savedPrefs) });
    const imported = localStorage.getItem("story-reader:imported-book");
    if (imported) {
      try { openBook(JSON.parse(imported)); return; } catch { localStorage.removeItem("story-reader:imported-book"); }
    }
    fetch("/book.json").then((response) => response.json()).then(openBook);
  }, [openBook]);

  useEffect(() => {
    if (!book || !activePart || !readerRef.current) return;
    const reader = readerRef.current;
    const saved = pendingPartProgressRef.current;
    const savedPoint = pendingScrollPointRef.current;
    const savedInset = pendingScrollInsetRef.current;
    pendingPartProgressRef.current = 0;
    pendingScrollPointRef.current = null;
    pendingScrollInsetRef.current = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = savedPoint ? getScrollTarget(reader, savedPoint) : saved * Math.max(0, reader.scrollHeight - reader.clientHeight);
      reader.scrollTop = Math.max(0, target - savedInset);
      restoringPositionRef.current = false;
      if (pendingWelcomeRef.current && !sessionStorage.getItem(`welcomed:${storageKey(book)}`)) {
        setWelcomeOpen(true);
        sessionStorage.setItem(`welcomed:${storageKey(book)}`, "yes");
      }
      pendingWelcomeRef.current = false;
    }));
  }, [activePart, book]);

  useEffect(() => {
    const nextHistory = book && activePart ? readScrollHistory(sessionStorage.getItem(partHistoryKey(book, activePart.id))) : createEmptyScrollHistory();
    scrollHistoryRef.current = nextHistory;
  }, [activePart, book]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const reader = readerRef.current;
      const marker = mainBookmarkRef.current;
      if (!reader || !marker || !sessionBookmark || sessionBookmark.partId !== activePart?.id) return;
      marker.style.top = `${getScrollTarget(reader, sessionBookmark.point)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [activePart?.id, preferences, readerGeometry, sessionBookmark]);

  useEffect(() => { localStorage.setItem("story-reader:preferences", JSON.stringify(preferences)); }, [preferences]);

  const applyLivePosition = useCallback((scrollPosition: number, geometry = readerGeometryRef.current, revealMinimap = false) => {
    const range = Math.max(0, geometry.scrollSize - geometry.viewportSize);
    const nextProgress = range > 0 ? Math.max(0, Math.min(1, scrollPosition / range)) : 0;
    const overallProgress = getOverallBookProgress(bookProgressMapRef.current, activePartIndexRef.current, nextProgress);
    const percent = Math.round(overallProgress * 100);

    minimapRef.current?.applyPosition(scrollPosition, geometry, revealMinimap);
    if (statusProgressRef.current) statusProgressRef.current.style.width = `${overallProgress * 100}%`;
    if (statusPercentRef.current) statusPercentRef.current.textContent = `${percent}%`;
  }, []);

  const commitPosition = useCallback((immediate = false) => {
    const reader = readerRef.current;
    if (!reader || !book || !activePart || restoringPositionRef.current) return null;
    const point = captureScrollPoint(reader);
    const next = point.progress;
    const location = createReadingLocation(activePart.id, partIndex, point);
    setProgress(next);
    setPartProgress(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const save = () => {
      writeReadingLocation(book, location);
      saveTimer.current = null;
    };
    if (immediate) save();
    else saveTimer.current = setTimeout(save, 180);
    return location;
  }, [activePart, book, partIndex]);

  useEffect(() => {
    const saveStop = () => { commitPosition(true); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveStop();
    };
    window.addEventListener("pagehide", saveStop);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveStop);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [commitPosition]);

  const updateScrollHistory = useCallback((nextHistory: ScrollHistory) => {
    scrollHistoryRef.current = nextHistory;
    if (book && activePart) sessionStorage.setItem(partHistoryKey(book, activePart.id), JSON.stringify(nextHistory));
  }, [activePart, book]);

  const recordNavigation = useCallback((origin: ScrollPoint, destination: number, force = false) => {
    const reader = readerRef.current;
    if (!reader || (!force && !isMeaningfulScrollJump(origin.scrollTop, destination, reader.clientHeight))) return false;
    updateScrollHistory(recordScrollNavigation(scrollHistoryRef.current, origin));
    return true;
  }, [updateScrollHistory]);

  const restoreScrollPoint = useCallback((point: ScrollPoint) => {
    const reader = readerRef.current;
    if (!reader) return;
    const target = getScrollTarget(reader, point);
    reader.scrollTo({ top: target, behavior: "auto" });
    applyLivePosition(target);
    commitPosition();
  }, [applyLivePosition, commitPosition]);

  const goBack = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return false;
    const step = stepScrollHistoryBack(scrollHistoryRef.current, captureScrollPoint(reader));
    if (!step.target) return false;
    updateScrollHistory(step.history);
    restoreScrollPoint(step.target);
    return true;
  }, [restoreScrollPoint, updateScrollHistory]);

  const goForward = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return false;
    const step = stepScrollHistoryForward(scrollHistoryRef.current, captureScrollPoint(reader));
    if (!step.target) return false;
    updateScrollHistory(step.history);
    restoreScrollPoint(step.target);
    return true;
  }, [restoreScrollPoint, updateScrollHistory]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      const moved = event.shiftKey ? goForward() : goBack();
      if (moved) event.preventDefault();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [goBack, goForward]);

  const handleReaderScroll = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return;
    applyLivePosition(reader.scrollTop, readerGeometryRef.current, true);
    if (minimapRef.current?.isDragging() || positionCommitTimer.current) return;
    positionCommitTimer.current = setTimeout(() => {
      positionCommitTimer.current = null;
      if (minimapRef.current?.isDragging()) return;
      commitPosition();
    }, positionCommitInterval);
  }, [applyLivePosition, commitPosition]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.addEventListener("scroll", handleReaderScroll, { passive: true });
    const measure = () => {
      const trackSize = minimapRef.current?.getTrackSize() ?? 0;
      const nextGeometry = getReaderGeometry(reader, trackSize);
      readerGeometryRef.current = nextGeometry;
      setReaderGeometry((current) => current.trackSize === nextGeometry.trackSize && current.viewportSize === nextGeometry.viewportSize && current.scrollSize === nextGeometry.scrollSize && current.previewScale === nextGeometry.previewScale ? current : nextGeometry);
      applyLivePosition(reader.scrollTop, nextGeometry);
      commitPosition();
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(reader);
    if (reader.firstElementChild instanceof HTMLElement) resizeObserver?.observe(reader.firstElementChild);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      reader.removeEventListener("scroll", handleReaderScroll);
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
      if (positionCommitTimer.current) clearTimeout(positionCommitTimer.current);
    };
  }, [applyLivePosition, commitPosition, handleReaderScroll]);

  const jumpTo = (next: number) => {
    const reader = readerRef.current;
    if (!reader) return;
    const target = Math.max(0, Math.min(1, next)) * (reader.scrollHeight - reader.clientHeight);
    recordNavigation(captureScrollPoint(reader), target);
    reader.scrollTo({ top: target, behavior: "smooth" });
  };
  const navigateToPart = (index: number, initialProgress = 0, initialPoint: ScrollPoint | null = null, initialInset = 0) => {
    const reader = readerRef.current;
    if (!book || !activePart || !reader) return;
    const targetIndex = Math.max(0, Math.min(book.parts.length - 1, index));
    const targetProgress = Math.max(0, Math.min(1, initialProgress));
    if (targetIndex === partIndex) { setContentsOpen(false); return; }
    const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
    const currentProgress = range > 0 ? reader.scrollTop / range : 0;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (positionCommitTimer.current) { clearTimeout(positionCommitTimer.current); positionCommitTimer.current = null; }
    localStorage.setItem(partProgressKey(book, activePart.id), String(currentProgress));
    const targetPart = book.parts[targetIndex];
    const targetPoint = initialPoint ?? createProgressPoint(targetProgress);
    writeReadingLocation(book, createReadingLocation(targetPart.id, targetIndex, targetPoint));
    pendingPartProgressRef.current = targetProgress;
    pendingScrollPointRef.current = initialPoint;
    pendingScrollInsetRef.current = Math.max(0, initialInset);
    restoringPositionRef.current = true;
    scrollHistoryRef.current = createEmptyScrollHistory();
    reader.scrollTop = 0;
    setProgress(targetProgress);
    setPartProgress(targetProgress);
    setPartTransitionDirection(targetIndex > partIndex ? "forward" : "backward");
    setPartIndex(targetIndex);
    setContentsOpen(false);
  };

  const jumpToOverallProgress = (next: number) => {
    const location = resolveOverallBookProgress(bookProgressMap, next);
    if (location.partIndex === partIndex) {
      jumpTo(location.partProgress);
      return;
    }
    navigateToPart(location.partIndex, location.partProgress);
  };

  const returnToSessionBookmark = () => {
    const reader = readerRef.current;
    if (!sessionBookmark || !reader) return;
    if (sessionBookmark.partIndex !== partIndex) {
      navigateToPart(sessionBookmark.partIndex, sessionBookmark.point.progress, sessionBookmark.point, bookmarkReturnInset);
      return;
    }
    const target = Math.max(0, getScrollTarget(reader, sessionBookmark.point) - bookmarkReturnInset);
    recordNavigation(captureScrollPoint(reader), target, true);
    reader.scrollTo({ top: target, behavior: "smooth" });
  };

  const setBookmarkHere = () => {
    if (!book) return;
    const location = commitPosition(true);
    if (!location) return;
    localStorage.setItem(bookmarkLocationKey(book), JSON.stringify(location));
    setSessionBookmark(location);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setImportError("");
    try {
      if (!file.name.toLowerCase().endsWith(".epub")) throw new Error("EPUB is the first enabled format. The others are ready in the format roadmap.");
      const imported = await parseEpub(file);
      openBook(imported);
      setLibraryOpen(false);
      if (JSON.stringify(imported).length < 4_000_000) localStorage.setItem("story-reader:imported-book", JSON.stringify(imported));
    } catch (error) { setImportError(error instanceof Error ? error.message : "That book could not be opened."); }
  };

  const recap = getRecap(partIndex, partProgress);
  const overallProgress = getOverallBookProgress(bookProgressMap, partIndex, progress);
  const sessionBookmarkOverallProgress = sessionBookmark
    ? getOverallBookProgress(bookProgressMap, sessionBookmark.partIndex, sessionBookmark.point.progress)
    : null;

  if (!book || !activePart) return <main className="loading-room"><span>Preparing your place in the story…</span></main>;
  const sessionBookmarkPart = sessionBookmark ? book.parts[sessionBookmark.partIndex] : null;
  const sessionBookmarkLabel = sessionBookmark && sessionBookmarkPart
    ? `Return to bookmark: ${sessionBookmarkPart.label}, ${Math.round(sessionBookmark.point.progress * 100)}%`
    : "Return to bookmark";
  const bookmarkActionLabel = sessionBookmark ? "Move bookmark to current position" : "Bookmark current position";

  return (
    <main className="reader-shell" style={{ "--reader-size": `${preferences.fontSize}px`, "--reader-leading": preferences.lineHeight, "--reader-measure": `${preferences.measure}ch` } as React.CSSProperties}>
      <header className="topbar">
        <div className="book-identity">
          <button className="book-mark" onClick={() => setLibraryOpen(true)} aria-label="Open library">BW</button>
          <button className="book-id" onClick={() => setContentsOpen(true)}>
            <span className="eyebrow">{book.title}</span>
            <span className="location">{activePart?.label} · {activePart?.title}</span>
          </button>
        </div>
        <nav className="part-navigation" aria-label="Part navigation">
          <button type="button" onClick={() => navigateToPart(partIndex - 1)} disabled={partIndex === 0} aria-label="Previous part" title="Previous part"><span aria-hidden="true">&#8592;</span></button>
          <span className="part-position" aria-live="polite">{partIndex + 1} / {book.parts.length}</span>
          <button type="button" onClick={() => navigateToPart(partIndex + 1)} disabled={partIndex === book.parts.length - 1} aria-label="Next part" title="Next part"><span aria-hidden="true">&#8594;</span></button>
        </nav>
        <div className="top-actions">
          <button className={`bookmark-action${sessionBookmark ? " has-bookmark" : ""}`} onClick={setBookmarkHere} aria-label={bookmarkActionLabel} title={bookmarkActionLabel}><span className="bookmark-action-icon" aria-hidden="true" /></button>
          <button className="memory-button" onClick={() => setSummaryOpen(true)} aria-label="What should I remember?" title="What should I remember?"><span className="memory-spark" aria-hidden="true">✦</span></button>
          <button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Reading settings">Aa</button>
        </div>
        {settingsOpen && <div className="settings-card floating-card">
          <div className="card-label">Reading comfort</div>
          <label>Text size <output>{preferences.fontSize}px</output><input type="range" min="18" max="30" value={preferences.fontSize} onChange={(event) => setPreferences({ ...preferences, fontSize: Number(event.target.value) })} /></label>
          <label>Line height <output>{preferences.lineHeight.toFixed(2)}</output><input type="range" min="1.3" max="1.9" step=".05" value={preferences.lineHeight} onChange={(event) => setPreferences({ ...preferences, lineHeight: Number(event.target.value) })} /></label>
          <label>Page width <output>{preferences.measure}ch</output><input type="range" min="52" max="82" value={preferences.measure} onChange={(event) => setPreferences({ ...preferences, measure: Number(event.target.value) })} /></label>
          <button className="quiet-action" onClick={() => setPreferences(defaultPreferences)}>Restore calm defaults</button>
        </div>}
      </header>

      <section className="reading-pane" id="book-reading-pane" ref={readerRef} tabIndex={0} aria-label={`${book.title} reading area`}>
        <article className={`page${partTransitionDirection ? ` part-enter-${partTransitionDirection}` : ""}`} key={activePart.id}>
          {sessionBookmark?.partId === activePart.id && <button className="reading-bookmark" ref={mainBookmarkRef} type="button"
            style={{ top: `${sessionBookmark.point.progress * Math.max(0, readerGeometry.scrollSize - readerGeometry.viewportSize)}px` }}
            onClick={returnToSessionBookmark} aria-label={sessionBookmarkLabel} title={sessionBookmarkLabel}><span aria-hidden="true" /></button>}
          <section className="book-part" id={`part-${partIndex}`} key={activePart.id}>
            {activeSections.map((blocks, sectionIndex) => <section className="part-section" data-reader-section data-scroll-anchor={`${activePart.id}:section:${sectionIndex}`} key={`${activePart.id}:section:${sectionIndex}`}>
              {sectionIndex === 0 && <header className="part-heading" data-minimap-kind="heading" data-minimap-key={`heading:${activePart.id}`}><p className="kicker">{activePart.label}</p><h1>{activePart.title}</h1><div className="ornament"><span /><i /><span /></div></header>}
              {blocks.map((block, blockIndex) => block.type === "break" ? <div className="scene-break" data-minimap-kind="break" data-scroll-anchor={`${activePart.id}:${sectionIndex}:${blockIndex}`} aria-label="Scene break" key={blockIndex}><i /></div> : <p data-minimap-kind="paragraph" data-scroll-anchor={`${activePart.id}:${sectionIndex}:${blockIndex}`} key={blockIndex} dangerouslySetInnerHTML={{ __html: block.html }} />)}
            </section>)}
          </section>
          <div className="end-mark"><i />End of {activePart.label}<i /></div>
        </article>
      </section>

      <ReaderMinimap ref={minimapRef} book={book} activePartId={activePart.id} readerRef={readerRef} progress={progress} geometry={readerGeometry}
        bookmarkProgress={sessionBookmark?.partId === activePart.id ? sessionBookmark.point.progress : null}
        onGeometryChange={(nextGeometry) => { readerGeometryRef.current = nextGeometry; setReaderGeometry(nextGeometry); }}
        onNavigation={recordNavigation} onBookmarkNavigation={returnToSessionBookmark} />

      <footer className="statusbar">
        <span>Part {partIndex + 1} of {book.parts.length}</span>
        <div className="status-line">
          <button className="status-position-control" aria-label="Position in the entire text" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const rawProgress = (event.clientX - rect.left) / rect.width; const snappedProgress = snapOverallBookProgress(bookProgressMap, rawProgress, Math.min(.07, 10 / Math.max(1, rect.width))); jumpToOverallProgress(snappedProgress); }}>
            <span className="status-track" /><span className="status-progress" ref={statusProgressRef} style={{ width: `${overallProgress * 100}%` }} />
            {bookProgressMap.boundaries.map((boundary, index) => <span className="status-part-guide" aria-hidden="true" style={{ left: `${boundary * 100}%` }} key={index} />)}
          </button>
          {sessionBookmarkOverallProgress !== null && <button className="status-bookmark" type="button" style={{ left: `${sessionBookmarkOverallProgress * 100}%` }} onClick={returnToSessionBookmark} aria-label={sessionBookmarkLabel} title={sessionBookmarkLabel}><span aria-hidden="true" /></button>}
        </div>
        <span ref={statusPercentRef}>{Math.round(overallProgress * 100)}%</span>
      </footer>

      {(summaryOpen || welcomeOpen) && <div className="scrim" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }} />}
      {(summaryOpen || welcomeOpen) && <aside className="memory-drawer open" aria-live="polite">
        <button className="drawer-close" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }} aria-label="Close summary">×</button>
        <p className="kicker">{welcomeOpen ? "Welcome back" : "A quiet reminder"}</p><h2>{recap.title}</h2><p className="memory-lead">{recap.lead}</p>
        <div className="memory-section"><h3>Keep these close</h3>{recap.remember.map((item) => <p key={item}>{item}</p>)}</div>
        <div className="memory-section people"><h3>People in the room</h3>{recap.people.map((item) => <p key={item}>{item}</p>)}</div>
        <button className="return-button" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }}>Return to the story</button>
      </aside>}

      {contentsOpen && <><div className="scrim" onClick={() => setContentsOpen(false)} /><aside className="left-drawer"><button className="drawer-close" onClick={() => setContentsOpen(false)}>×</button><p className="kicker">Contents</p><h2>{book.title}</h2><nav>{book.parts.map((part, index) => <button className={index === partIndex ? "current" : ""} key={part.id} onClick={() => navigateToPart(index)}><span>{String(index + 1).padStart(2, "0")}</span><b>{part.title}</b></button>)}</nav></aside></>}

      {libraryOpen && <><div className="scrim" onClick={() => setLibraryOpen(false)} /><section className="library-modal"><button className="drawer-close" onClick={() => setLibraryOpen(false)}>×</button><p className="kicker">Your reading room</p><h2>Open another book</h2><p className="modal-copy">EPUB is fully supported in this first release. The format shelf is already shaped for the readers that come next.</p><button className="import-button" onClick={() => fileRef.current?.click()}>Choose an EPUB</button><input ref={fileRef} hidden type="file" accept=".epub,application/epub+zip" onChange={(event) => importFile(event.target.files?.[0])} />{importError && <p className="import-error">{importError}</p>}<div className="format-grid">{formatSupport.map((format) => <div className={format.status} key={format.extension}><span>{format.extension}</span><b>{format.label}</b><small>{format.status === "available" ? "Ready now" : "Adapter ready"}</small></div>)}</div>{book.title !== "Before We Were Us" && <button className="quiet-action" onClick={() => { localStorage.removeItem("story-reader:imported-book"); fetch("/book.json").then((r) => r.json()).then(openBook); setLibraryOpen(false); }}>Return to Before We Were Us</button>}<a className="download-link" href="/before-we-were-us.epub" download>Download this manuscript as EPUB</a></section></>}
    </main>
  );
}
