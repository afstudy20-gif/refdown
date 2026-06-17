import { formatCitation } from "../lib/format.js";
import { toBibTeX, toRIS } from "../lib/export.js";

const $ = (id) => document.getElementById(id);
let current = null;

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  const fallback = metadataFromUrl(tab.url, tab.title);
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/scraper.js"]
    });
    return { ...fallback, ...(result || {}), pageUrl: tab.url, pageTitle: tab.title };
  } catch (error) {
    if (fallback.pmcid || isPdfUrl(tab.url)) return fallback;
    throw error;
  }
}

function metadataFromUrl(url, title) {
  const pmcid = String(url || "").match(/(?:\/articles\/)?(PMC\d+)/i)?.[1]?.toUpperCase() || null;
  return {
    type: pmcid ? "article-journal" : "webpage",
    title: null,
    authors: [],
    issued: null,
    containerTitle: null,
    publisher: null,
    siteName: null,
    doi: null,
    isbn: null,
    pmid: null,
    pmcid,
    arxivId: null,
    url,
    pageUrl: url,
    pageTitle: title,
    accessed: {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      day: new Date().getDate()
    },
    pageNumber: null,
    volume: null,
    issue: null,
    abstract: null
  };
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

  const scihubVal = m.doi || m.pmid;
  if (scihubVal) {
    $("scihub-row").hidden = false;
    const url = `https://sci-hub.st/${encodeURIComponent(scihubVal)}`;
    $("m-scihub").innerHTML = `<a href="${url}" target="_blank" class="scihub-link">🔎 Sci-Hub'da Ara</a>`;
  } else {
    $("scihub-row").hidden = true;
  }

  const scholarVal = m.title;
  if (scholarVal) {
    $("scholar-row").hidden = false;
    const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(scholarVal)}`;
    $("m-scholar").innerHTML = `<a href="${url}" target="_blank" class="scholar-link">🔎 Scholar'da Ara</a>`;
  } else {
    $("scholar-row").hidden = true;
  }

  updatePdfButton(m);
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
  if (m.pmcid) return "PubMed Central";
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
  if (!a) return;
  const href = a.getAttribute("href");
  if (href === "#") {
    e.preventDefault();
  } else if (href && href.startsWith("http")) {
    e.preventDefault();
    chrome.tabs.create({ url: href });
  }
});

// --- ArticleEditor Integration ---

function isPdfUrl(value) {
  try {
    const url = new URL(value);
    return /\.pdf(?:$|[?#])/i.test(url.href) ||
      /pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/pdf\//i.test(url.href) ||
      /arxiv\.org\/pdf\//i.test(url.href);
  } catch {
    return false;
  }
}

function updatePdfButton(meta) {
  const button = $("ae-open-pdf");
  const pdfUrl = meta?.pdfUrl || meta?.pageUrl || meta?.url;
  button.hidden = !meta?.pdfUrl && !isPdfUrl(pdfUrl);
  button.dataset.pdfUrl = button.hidden ? "" : pdfUrl;
}

$("ae-open-pdf").addEventListener("click", async () => {
  const pdfUrl = $("ae-open-pdf").dataset.pdfUrl;
  if (!pdfUrl) return;
  const readerUrl = `https://arted.drtr.uk/reader?url=${encodeURIComponent(pdfUrl)}`;
  await chrome.tabs.create({ url: readerUrl });
});

function metaToAERef(m) {
  return {
    title: m.title || null,
    authors: (m.authors || []).map(a => ({
      family: a.family || null,
      given: a.given || null,
      literal: a.literal || null
    })).filter(a => a.family || a.given || a.literal),
    year: m.issued?.year || null,
    doi: m.doi || null,
    pmid: m.pmid || null,
    url: m.pageUrl || m.url || null,
    containerTitle: m.containerTitle || null,
    volume: m.volume || null,
    issue: m.issue || null,
    pages: m.pageNumber || null,
    abstract: m.abstract || null,
    publisher: m.publisher || null,
    type: m.type || "webpage",
    source: "refdown-extension"
  };
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

async function loadAEProjects() {
  const section = $("ae-section");
  const status = $("ae-status");
  const list = $("ae-projects");

  section.hidden = false;
  status.textContent = "Connecting…";
  list.innerHTML = "";

  try {
    const res = await chrome.runtime.sendMessage({ type: "list-ae-projects" });
    if (res.noTab) {
      status.textContent = "Open ArticleEditor to add refs";
      list.innerHTML = '<button class="ae-project" id="ae-open-btn">🌐 Open ArticleEditor</button>';
      $("ae-open-btn").addEventListener("click", async () => {
        await chrome.tabs.create({ url: "https://arted.drtr.uk/edit" });
        setTimeout(loadAEProjects, 2000);
      });
      return;
    }
    if (!res.projects || res.error) {
      status.textContent = res.error || "Could not connect";
      return;
    }
    if (res.projects.length === 0) {
      status.textContent = "No projects yet";
      return;
    }
    status.textContent = `${res.projects.length} project${res.projects.length > 1 ? "s" : ""}`;
    list.innerHTML = res.projects.map(p => `
      <button class="ae-project" data-pid="${esc(p.id)}">
        <span class="ae-p-title">${esc(p.title)}</span>
        <span class="ae-p-count">${p.refCount} refs</span>
      </button>
    `).join("");

    list.querySelectorAll(".ae-project").forEach(btn => {
      btn.addEventListener("click", () => addToAEProject(btn));
    });
  } catch (e) {
    status.textContent = "Extension error";
    console.error("[refdown] AE error:", e);
  }
}

async function addToAEProject(btn) {
  if (!current) {
    flash(btn, "Cite first!");
    return;
  }
  const pid = btn.dataset.pid;
  btn.classList.add("ae-adding");
  btn.querySelector(".ae-p-count").textContent = "Adding…";

  try {
    const refData = metaToAERef(current);
    const res = await chrome.runtime.sendMessage({
      type: "add-ref-to-ae",
      projectId: pid,
      refData
    });
    btn.classList.remove("ae-adding");
    if (res.success) {
      btn.classList.add("ae-success");
      btn.querySelector(".ae-p-count").textContent = "✓ Added";
      setTimeout(() => {
        btn.classList.remove("ae-success");
        loadAEProjects();
      }, 1500);
    } else if (res.duplicate) {
      btn.querySelector(".ae-p-count").textContent = "Already exists";
      setTimeout(() => loadAEProjects(), 1500);
    } else {
      btn.classList.add("ae-error");
      btn.querySelector(".ae-p-count").textContent = res.error || "Error";
      setTimeout(() => {
        btn.classList.remove("ae-error");
        loadAEProjects();
      }, 2000);
    }
  } catch (e) {
    btn.classList.remove("ae-adding");
    btn.querySelector(".ae-p-count").textContent = "Error";
  }
}

$("ae-refresh").addEventListener("click", loadAEProjects);
loadAEProjects();

// Intercept PDF toggle
const pdfToggle = $("intercept-pdf-toggle");
chrome.storage.local.get("interceptPdfs", (res) => {
  pdfToggle.checked = res.interceptPdfs !== false;
});
pdfToggle.addEventListener("change", () => {
  chrome.storage.local.set({ interceptPdfs: pdfToggle.checked });
});

(async () => {
  const { lastStyle } = await chrome.storage.local.get("lastStyle");
  if (lastStyle) $("style").value = lastStyle;
  $("style").addEventListener("change", () => chrome.storage.local.set({ lastStyle: $("style").value }));
  cite();
})();
