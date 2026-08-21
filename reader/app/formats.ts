import { strFromU8, unzipSync } from "fflate";

export type BookBlock = { type: "p" | "break"; html: string };
export type BookPart = { id: string; label: string; title: string; blocks: BookBlock[] };
export type ReaderBook = { format: string; title: string; author: string; parts: BookPart[] };

export function splitPartSections(blocks: BookBlock[]) {
  const sections: BookBlock[][] = [];
  let current: BookBlock[] = [];
  for (const block of blocks) {
    if (block.type === "break" && current.some((item) => item.type === "p")) {
      sections.push(current);
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length || sections.length === 0) sections.push(current);
  return sections;
}

export const formatSupport = [
  { extension: ".epub", label: "EPUB", status: "available" },
  { extension: ".md", label: "Markdown", status: "planned" },
  { extension: ".txt", label: "Plain text", status: "planned" },
  { extension: ".html", label: "HTML", status: "planned" },
  { extension: ".pdf", label: "PDF", status: "planned" },
  { extension: ".mobi", label: "MOBI / AZW", status: "planned" },
] as const;

const text = (files: Record<string, Uint8Array>, path: string) => {
  const file = files[path];
  if (!file) throw new Error(`EPUB is missing ${path}`);
  return strFromU8(file);
};
const resolvePath = (base: string, relative: string) => {
  const segments = `${base}/${relative}`.split("/");
  const clean: string[] = [];
  for (const segment of segments) segment === ".." ? clean.pop() : segment !== "." && clean.push(segment);
  return clean.join("/");
};

export async function parseEpub(file: File): Promise<ReaderBook> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const parser = new DOMParser();
  const container = parser.parseFromString(text(files, "META-INF/container.xml"), "application/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB has no package document.");
  const opf = parser.parseFromString(text(files, opfPath), "application/xml");
  const opfBase = opfPath.split("/").slice(0, -1).join("/");
  const manifest = new Map(Array.from(opf.querySelectorAll("manifest item")).map((item) => [item.getAttribute("id"), item.getAttribute("href")]));
  const spine = Array.from(opf.querySelectorAll("spine itemref")).map((item) => item.getAttribute("idref")).filter(Boolean) as string[];
  const title = opf.querySelector("metadata title")?.textContent?.trim() || file.name.replace(/\.epub$/i, "");
  const author = opf.querySelector("metadata creator")?.textContent?.trim() || "Unknown author";
  const allowed = new Set(["EM", "STRONG", "I", "B", "SPAN"]);
  const parts = spine.map((id, index) => {
    const href = manifest.get(id);
    if (!href) throw new Error(`EPUB spine item ${id} has no manifest entry.`);
    const doc = parser.parseFromString(text(files, resolvePath(opfBase, href)), "application/xhtml+xml");
    const heading = doc.querySelector("h1, h2")?.textContent?.trim() || `Chapter ${index + 1}`;
    const nodes = Array.from(doc.body.querySelectorAll("p, hr, .scene-break"));
    const blocks: BookBlock[] = nodes.map((node) => {
      if (node.tagName === "HR" || node.classList.contains("scene-break")) return { type: "break", html: "" };
      const copy = node.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("*").forEach((child) => { if (!allowed.has(child.tagName)) child.replaceWith(...Array.from(child.childNodes)); });
      copy.querySelectorAll("*").forEach((child) => Array.from(child.attributes).forEach((attribute) => child.removeAttribute(attribute.name)));
      return { type: "p", html: copy.innerHTML };
    });
    return { id: `imported-${index + 1}`, label: `Chapter ${index + 1}`, title: heading, blocks };
  });
  return { format: "epub", title, author, parts };
}
