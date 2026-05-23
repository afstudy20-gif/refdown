import { formatCitation } from "../lib/format.js";
import { toBibTeX, toRIS } from "../lib/export.js";

const $ = (id) => document.getElementById(id);
let current = null;

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/scraper.js"]
  });
  return { ...result, pageUrl: tab.url, pageTitle: tab.title };
}

async function enrich(meta) {
  return chrome.runtime.sendMessage({ type: "enrich", meta });
}

function fallbackHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

function renderMeta(m) {
  $("meta").hidden = false;
  $("m-type").textContent = m.type || "webpage";
  $("m-title").textContent = m.title || "—";
  $("m-authors").textContent = (m.authors || []).map(authorLabel).join(", ") || "—";
  const host = fallbackHost(m.pageUrl || m.url);
  $("m-year").textContent = m.issued?.year || "—";
  $("m-source").textContent = m.containerTitle || m.publisher || m.siteName || host || "—";
  $("m-id").textContent = m.doi ? `doi:${m.doi}` : m.pageUrl || "—";
}

function authorLabel(a) {
  if (a.literal) return a.literal;
  return [a.given, a.family].filter(Boolean).join(" ");
}

function sourceMode() {
  return document.querySelector('input[name="src"]:checked')?.value || "auto";
}

function detectedKind(m) {
  if (m.doi) return "DOI / journal";
  if (m.pmid) return "PubMed";
  if (m.arxivId) return "arXiv";
  if (m.isbn) return "Book (ISBN)";
  if (m.containerTitle) return "Journal";
  if (m.publisher) return "Publisher";
  return "Web page";
}

function forceWebpage(m) {
  return {
    ...m,
    type: "webpage",
    doi: null,
    pmid: null,
    arxivId: null,
    isbn: null,
    containerTitle: null,
    publisher: null,
    volume: null,
    issue: null,
    pageNumber: null
  };
}

async function cite() {
  const style = $("style").value;
  try {
    let meta = await scrapeActiveTab();
    const mode = sourceMode();
    if (mode === "auto") meta = await enrich(meta);
    if (mode === "webpage") meta = forceWebpage(meta);
    if (mode === "auto" && !meta.doi && !meta.pmid && !meta.arxivId && !meta.isbn && !meta.containerTitle && !meta.publisher) {
      meta.type = "webpage";
    }
    current = meta;
    const dk = detectedKind(meta);
    const log = meta._enrichLog?.join(" → ") || "";
    $("detected").textContent = log ? `${dk} · ${log}` : `detected: ${dk}`;
    renderMeta(meta);
    const text = await formatCitation(meta, style);
    $("cite").value = text;
    saveHistory(meta, style, text);
  } catch (e) {
    $("cite").value = `Error: ${e.message}`;
  }
}

async function copy() {
  await navigator.clipboard.writeText($("cite").value);
  flash($("copy-btn"), "Copied");
}

function download(filename, text) {
  const mime = filename.endsWith(".bib")
    ? "application/x-bibtex"
    : filename.endsWith(".ris")
    ? "application/x-research-info-systems"
    : "application/octet-stream";
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

function flash(btn, label) {
  const orig = btn.textContent;
  btn.textContent = label;
  setTimeout(() => (btn.textContent = orig), 1200);
}

async function saveHistory(meta, style, text) {
  const { history = [] } = await chrome.storage.local.get("history");
  history.unshift({ ts: Date.now(), style, text, meta });
  await chrome.storage.local.set({ history: history.slice(0, 200) });
}

$("cite-btn").addEventListener("click", cite);
$("copy-btn").addEventListener("click", copy);
$("bib-btn").addEventListener("click", () => {
  if (!current) return;
  download(`${slug(current)}.bib`, toBibTeX(current));
});
$("ris-btn").addEventListener("click", () => {
  if (!current) return;
  download(`${slug(current)}.ris`, toRIS(current));
});
$("style").addEventListener("change", async () => {
  if (!current) return;
  $("cite").value = await formatCitation(current, $("style").value);
});
document.querySelectorAll('input[name="src"]').forEach((el) => {
  el.addEventListener("change", () => cite());
});

function slug(m) {
  const a = (m.authors?.[0]?.family || "ref").toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = m.issued?.year || "";
  return `${a}${y}`;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (a && a.getAttribute("href") === "#") e.preventDefault();
});

(async () => {
  const { lastStyle } = await chrome.storage.local.get("lastStyle");
  if (lastStyle) $("style").value = lastStyle;
  $("style").addEventListener("change", () => chrome.storage.local.set({ lastStyle: $("style").value }));
  cite();
})();
