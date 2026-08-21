"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSupport, parseEpub, type ReaderBook } from "./formats";
import { getRecap } from "./recaps";
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

function storageKey(book: ReaderBook) { return `story-reader:${book.title.toLowerCase().replace(/\W+/g, "-")}`; }

export default function Home() {
  const readerRef = useRef<HTMLElement>(null);
  const minimapRef = useRef<ReaderMinimapHandle>(null);
  const statusProgressRef = useRef<HTMLElement>(null);
  const statusPercentRef = useRef<HTMLSpanElement>(null);
  const readerGeometryRef = useRef<ReaderGeometry>(defaultReaderGeometry);
  const scrollHistoryRef = useRef<ScrollHistory>(createEmptyScrollHistory());
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [progress, setProgress] = useState(0);
  const [readerGeometry, setReaderGeometry] = useState(defaultReaderGeometry);
  const [partIndex, setPartIndex] = useState(0);
  const [partProgress, setPartProgress] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    const savedPrefs = localStorage.getItem("story-reader:preferences");
    if (savedPrefs) setPreferences({ ...defaultPreferences, ...JSON.parse(savedPrefs) });
    const imported = localStorage.getItem("story-reader:imported-book");
    if (imported) {
      try { setBook(JSON.parse(imported)); return; } catch { localStorage.removeItem("story-reader:imported-book"); }
    }
    fetch("/book.json").then((response) => response.json()).then(setBook);
  }, []);

  useEffect(() => {
    if (!book || !readerRef.current) return;
    const reader = readerRef.current;
    const saved = Number(localStorage.getItem(`${storageKey(book)}:progress`) || 0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reader.scrollTop = saved * Math.max(0, reader.scrollHeight - reader.clientHeight);
      if (saved > .004 && !sessionStorage.getItem(`welcomed:${storageKey(book)}`)) {
        setWelcomeOpen(true);
        sessionStorage.setItem(`welcomed:${storageKey(book)}`, "yes");
      }
    }));
  }, [book]);

  useEffect(() => {
    const nextHistory = book ? readScrollHistory(sessionStorage.getItem(`${storageKey(book)}:scroll-history`)) : createEmptyScrollHistory();
    scrollHistoryRef.current = nextHistory;
  }, [book]);

  useEffect(() => { localStorage.setItem("story-reader:preferences", JSON.stringify(preferences)); }, [preferences]);

  const applyLivePosition = useCallback((scrollPosition: number, geometry = readerGeometryRef.current, revealMinimap = false) => {
    const range = Math.max(0, geometry.scrollSize - geometry.viewportSize);
    const nextProgress = range > 0 ? Math.max(0, Math.min(1, scrollPosition / range)) : 0;
    const percent = Math.round(nextProgress * 100);

    minimapRef.current?.applyPosition(scrollPosition, geometry, revealMinimap);
    if (statusProgressRef.current) statusProgressRef.current.style.width = `${nextProgress * 100}%`;
    if (statusPercentRef.current) statusPercentRef.current.textContent = `${percent}%`;
  }, []);

  const commitPosition = useCallback(() => {
    const reader = readerRef.current;
    if (!reader || !book) return;
    const range = reader.scrollHeight - reader.clientHeight;
    const next = range > 0 ? reader.scrollTop / range : 0;
    setProgress(next);
    const sections = Array.from(reader.querySelectorAll<HTMLElement>(".book-part"));
    const focus = reader.scrollTop + reader.clientHeight * .36;
    let current = 0;
    sections.forEach((section, index) => { if (section.offsetTop <= focus) current = index; });
    const section = sections[current];
    const sectionEnd = sections[current + 1]?.offsetTop ?? reader.scrollHeight;
    setPartIndex(current);
    setPartProgress(Math.max(0, Math.min(1, (focus - section.offsetTop) / (sectionEnd - section.offsetTop))));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => localStorage.setItem(`${storageKey(book)}:progress`, String(next)), 180);
  }, [book]);

  const updateScrollHistory = useCallback((nextHistory: ScrollHistory) => {
    scrollHistoryRef.current = nextHistory;
    if (book) sessionStorage.setItem(`${storageKey(book)}:scroll-history`, JSON.stringify(nextHistory));
  }, [book]);

  const recordNavigation = useCallback((origin: ScrollPoint, destination: number) => {
    const reader = readerRef.current;
    if (!reader || !isMeaningfulScrollJump(origin.scrollTop, destination, reader.clientHeight)) return false;
    updateScrollHistory(recordScrollNavigation(scrollHistoryRef.current, origin));
    return true;
  }, [updateScrollHistory]);

  const restoreScrollPoint = useCallback((point: ScrollPoint) => {
    const reader = readerRef.current;
    if (!reader) return;
    const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
    let target = point.progress * range;
    if (point.anchor) {
      const anchor = Array.from(reader.querySelectorAll<HTMLElement>("[data-scroll-anchor]")).find((element) => element.dataset.scrollAnchor === point.anchor);
      if (anchor) target = getElementScrollTop(reader, anchor) + point.anchorOffset * anchor.offsetHeight;
    }
    target = Math.max(0, Math.min(range, target));
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
  const jumpToPart = (index: number) => {
    const reader = readerRef.current;
    const part = reader?.querySelector<HTMLElement>(`#part-${index}`);
    if (reader && part) {
      recordNavigation(captureScrollPoint(reader), getElementScrollTop(reader, part));
      part.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setContentsOpen(false);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setImportError("");
    try {
      if (!file.name.toLowerCase().endsWith(".epub")) throw new Error("EPUB is the first enabled format. The others are ready in the format roadmap.");
      const imported = await parseEpub(file);
      setBook(imported);
      setLibraryOpen(false);
      if (JSON.stringify(imported).length < 4_000_000) localStorage.setItem("story-reader:imported-book", JSON.stringify(imported));
    } catch (error) { setImportError(error instanceof Error ? error.message : "That book could not be opened."); }
  };

  const activePart = book?.parts[partIndex];
  const recap = getRecap(partIndex, partProgress);

  if (!book) return <main className="loading-room"><span>Preparing your place in the story…</span></main>;

  return (
    <main className="reader-shell" style={{ "--reader-size": `${preferences.fontSize}px`, "--reader-leading": preferences.lineHeight, "--reader-measure": `${preferences.measure}ch` } as React.CSSProperties}>
      <header className="topbar">
        <button className="book-mark" onClick={() => setLibraryOpen(true)} aria-label="Open library">BW</button>
        <button className="book-id" onClick={() => setContentsOpen(true)}>
          <span className="eyebrow">{book.title}</span>
          <span className="location">{activePart?.label} · {activePart?.title}</span>
        </button>
        <div className="top-actions">
          <button className="memory-button" onClick={() => setSummaryOpen(true)}><span className="memory-spark">✦</span><span>What should I remember?</span></button>
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
        <article className="page">
          {book.parts.map((part, index) => <section className="book-part" id={`part-${index}`} key={part.id}>
            <header className="part-heading"><p className="kicker">{part.label}</p><h1>{part.title}</h1><div className="ornament"><span /><i /><span /></div></header>
            {part.blocks.map((block, blockIndex) => block.type === "break" ? <div className="scene-break" data-scroll-anchor={`${part.id}:${blockIndex}`} aria-label="Scene break" key={blockIndex}><i /></div> : <p data-scroll-anchor={`${part.id}:${blockIndex}`} key={blockIndex} dangerouslySetInnerHTML={{ __html: block.html }} />)}
          </section>)}
          <div className="end-mark"><i />End<i /></div>
        </article>
      </section>

      <ReaderMinimap ref={minimapRef} book={book} readerRef={readerRef} progress={progress} geometry={readerGeometry}
        onGeometryChange={(nextGeometry) => { readerGeometryRef.current = nextGeometry; setReaderGeometry(nextGeometry); }}
        onNavigation={recordNavigation} onPositionCommit={commitPosition} />

      <footer className="statusbar"><span>{activePart?.label} of {book.parts.length}</span><button className="status-line" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); jumpTo((event.clientX - rect.left) / rect.width); }}><i ref={statusProgressRef} style={{ width: `${progress * 100}%` }} /></button><span ref={statusPercentRef}>{Math.round(progress * 100)}%</span></footer>

      {(summaryOpen || welcomeOpen) && <div className="scrim" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }} />}
      {(summaryOpen || welcomeOpen) && <aside className="memory-drawer open" aria-live="polite">
        <button className="drawer-close" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }} aria-label="Close summary">×</button>
        <p className="kicker">{welcomeOpen ? "Welcome back" : "A quiet reminder"}</p><h2>{recap.title}</h2><p className="memory-lead">{recap.lead}</p>
        <div className="memory-section"><h3>Keep these close</h3>{recap.remember.map((item) => <p key={item}>{item}</p>)}</div>
        <div className="memory-section people"><h3>People in the room</h3>{recap.people.map((item) => <p key={item}>{item}</p>)}</div>
        <button className="return-button" onClick={() => { setSummaryOpen(false); setWelcomeOpen(false); }}>Return to the story</button>
      </aside>}

      {contentsOpen && <><div className="scrim" onClick={() => setContentsOpen(false)} /><aside className="left-drawer"><button className="drawer-close" onClick={() => setContentsOpen(false)}>×</button><p className="kicker">Contents</p><h2>{book.title}</h2><nav>{book.parts.map((part, index) => <button className={index === partIndex ? "current" : ""} key={part.id} onClick={() => jumpToPart(index)}><span>{String(index + 1).padStart(2, "0")}</span><b>{part.title}</b></button>)}</nav></aside></>}

      {libraryOpen && <><div className="scrim" onClick={() => setLibraryOpen(false)} /><section className="library-modal"><button className="drawer-close" onClick={() => setLibraryOpen(false)}>×</button><p className="kicker">Your reading room</p><h2>Open another book</h2><p className="modal-copy">EPUB is fully supported in this first release. The format shelf is already shaped for the readers that come next.</p><button className="import-button" onClick={() => fileRef.current?.click()}>Choose an EPUB</button><input ref={fileRef} hidden type="file" accept=".epub,application/epub+zip" onChange={(event) => importFile(event.target.files?.[0])} />{importError && <p className="import-error">{importError}</p>}<div className="format-grid">{formatSupport.map((format) => <div className={format.status} key={format.extension}><span>{format.extension}</span><b>{format.label}</b><small>{format.status === "available" ? "Ready now" : "Adapter ready"}</small></div>)}</div>{book.title !== "Before We Were Us" && <button className="quiet-action" onClick={() => { localStorage.removeItem("story-reader:imported-book"); fetch("/book.json").then((r) => r.json()).then(setBook); setLibraryOpen(false); }}>Return to Before We Were Us</button>}<a className="download-link" href="/before-we-were-us.epub" download>Download this manuscript as EPUB</a></section></>}
    </main>
  );
}
