import { readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manuscriptPath = path.resolve(root, "..", "manuscript", "before-we-were-us-working-manuscript.md");
const source = await readFile(manuscriptPath, "utf8");
const title = "Before We Were Us";

const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const inline = (value) => escapeXml(value)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const parts = source.split(/^## Part /m).slice(1).map((chunk, index) => {
  const [heading, ...bodyLines] = chunk.split(/\r?\n/);
  const [numberWord, partTitle] = heading.split(": ");
  const raw = bodyLines.join("\n").trim();
  const blocks = raw.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).filter(Boolean).map((block) => {
    if (block === "* * *" || block === "---") return { type: "break", html: "" };
    return { type: "p", html: inline(block.replace(/\r?\n/g, " ")) };
  });
  return { id: `part-${index + 1}`, label: `Part ${numberWord}`, title: partTitle, blocks };
});

const book = { format: "epub", title, author: "Pluribus Prequel Project", parts };
await mkdir(path.join(root, "public"), { recursive: true });
await writeFile(path.join(root, "public", "book.json"), JSON.stringify(book));

const navItems = parts.map((part, index) => `<li><a href="chapter-${index + 1}.xhtml">${escapeXml(part.label)}: ${escapeXml(part.title)}</a></li>`).join("");
const manifestItems = parts.map((_, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("");
const spineItems = parts.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join("");
const chapterFiles = Object.fromEntries(parts.map((part, index) => {
  const content = part.blocks.map((block) => block.type === "break" ? '<div class="scene-break">◆</div>' : `<p>${block.html}</p>`).join("\n");
  return [`OEBPS/chapter-${index + 1}.xhtml`, strToU8(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(part.title)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head><body><section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops"><p class="part">${escapeXml(part.label)}</p><h1>${escapeXml(part.title)}</h1>${content}</section></body></html>`)]
}));

const files = {
  "mimetype": [strToU8("application/epub+zip"), { level: 0 }],
  "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">before-we-were-us</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language><dc:creator>Pluribus Prequel Project</dc:creator><meta property="dcterms:modified">2026-08-20T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${manifestItems}</manifest><spine>${spineItems}</spine></package>`),
  "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${navItems}</ol></nav></body></html>`),
  "OEBPS/style.css": strToU8("body{font-family:serif;line-height:1.5}h1{page-break-before:always}.part{text-transform:uppercase;letter-spacing:.12em}.scene-break{text-align:center;margin:2em 0}"),
  ...chapterFiles,
};
await writeFile(path.join(root, "public", "before-we-were-us.epub"), zipSync(files, { level: 6 }));
console.log(`Generated ${parts.length} EPUB chapters and book.json from ${manuscriptPath}`);
