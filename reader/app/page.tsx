"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSupport, parseEpub, type ReaderBook } from "./formats";
import { getRecap } from "./recaps";

type Preferences = { fontSize: number; lineHeight: number; measure: number };
const defaultPreferences: Preferences = { fontSize: 22, lineHeight: 1.5, measure: 68 };
const builtInKey = "before-we-were-us";

function storageKey(book: ReaderBook) { return `story-reader:${book.title.toLowerCase().replace(/\W+/g, "-")}`; }

export default function Home() {
  const readerRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [progress, setProgress] = useState(0);
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

  useEffect(() => { localStorage.setItem("story-reader:preferences", JSON.stringify(preferences)); }, [preferences]);

  const updatePosition = useCallback(() => {
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

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);
    return () => { reader.removeEventListener("scroll", updatePosition); window.removeEventListener("resize", updatePosition); };
  }, [updatePosition]);

  const jumpTo = (next: number) => {
    const reader = readerRef.current;
    if (!reader) return;
    reader.scrollTo({ top: Math.max(0, Math.min(1, next)) * (reader.scrollHeight - reader.clientHeight), behavior: "smooth" });
  };
  const jumpToPart = (index: number) => {
    readerRef.current?.querySelector<HTMLElement>(`#part-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const allBlocks = useMemo(() => book?.parts.flatMap((part) => part.blocks) ?? [], [book]);
  const activeBlock = Math.round(progress * Math.max(0, allBlocks.length - 1));
  const mapLines = useMemo(() => {
    if (!allBlocks.length) return [];
    const radius = 54;
    return Array.from({ length: radius * 2 + 1 }, (_, offset) => {
      const index = activeBlock - radius + offset;
      const block = allBlocks[index];
      return { index, active: offset === radius, break: block?.type === "break", width: block ? 34 + ((block.html.length * 17 + index * 13) % 61) : 0 };
    });
  }, [activeBlock, allBlocks]);

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

      <section className="reading-pane" ref={readerRef} tabIndex={0} aria-label={`${book.title} reading area`}>
        <article className="page">
          {book.parts.map((part, index) => <section className="book-part" id={`part-${index}`} key={part.id}>
            <header className="part-heading"><p className="kicker">{part.label}</p><h1>{part.title}</h1><div className="ornament"><span /><i /><span /></div></header>
            {part.blocks.map((block, blockIndex) => block.type === "break" ? <div className="scene-break" aria-label="Scene break" key={blockIndex}><i /></div> : <p key={blockIndex} dangerouslySetInnerHTML={{ __html: block.html }} />)}
          </section>)}
          <div className="end-mark"><i />End<i /></div>
        </article>
      </section>

      <aside className="minimap" aria-label="Zoomed-out book preview" onPointerDown={(event) => {
        const element = event.currentTarget;
        element.setPointerCapture(event.pointerId);
        const move = (clientY: number) => { const rect = element.getBoundingClientRect(); jumpTo((clientY - rect.top) / rect.height); };
        move(event.clientY);
        element.onpointermove = (moveEvent) => move(moveEvent.clientY);
        element.onpointerup = () => { element.onpointermove = null; element.onpointerup = null; };
      }}>
        <div className="map-tape" aria-hidden="true">{mapLines.map((line) => <i key={line.index} className={`${line.active ? "active" : ""} ${line.break ? "break" : ""}`} style={{ width: `${line.width}%` }} />)}</div>
        <div className="map-focus" /><div className="map-rail"><i style={{ top: `${progress * 100}%` }} /></div>
        <span className="map-progress">{Math.round(progress * 100)}%</span>
      </aside>

      <footer className="statusbar"><span>{activePart?.label} of {book.parts.length}</span><button className="status-line" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); jumpTo((event.clientX - rect.left) / rect.width); }}><i style={{ width: `${progress * 100}%` }} /></button><span>{Math.round(progress * 100)}%</span></footer>

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
