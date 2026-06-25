import { formatCitation } from "../lib/format.js";
import { toBibTeX, toRIS } from "../lib/export.js";

const $ = (id) => document.getElementById(id);
let current = null;
const PDF_DOWNLOAD_FOLDER = "RefDown PDFs";

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

function setPdfDownloadStatus(text) {
  $("pdf-download-status").textContent = text;
}

function sanitizeFilename(name) {
  const cleaned = String(name || "document.pdf")
    .replace(/[<>:"\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const base = cleaned || "document.pdf";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("dosyaId") || u.searchParams.get("fileId") || u.searchParams.get("id");
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
    if (/fileDownload/i.test(last) && id) return sanitizeFilename(`document_${id}.pdf`);
    return sanitizeFilename(last || (id ? `document_${id}.pdf` : "document.pdf"));
  } catch {
    return "document.pdf";
  }
}

function downloadUrl(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url,
        filename: `${PDF_DOWNLOAD_FOLDER}/${sanitizeFilename(filename)}`,
        saveAs: false,
        conflictAction: "uniquify"
      },
      () => {
        const err = chrome.runtime.lastError;
        resolve({ ok: !err, error: err?.message });
      }
    );
  });
}

function needsPageClickDownload(url) {
  try {
    const parsed = new URL(url);
    return /fileDownload\.htm$/i.test(parsed.pathname) || /ardeb-pbs\.tubitak\.gov\.tr$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function collectPagePdfs() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  const fallback = isPdfUrl(tab.url) ? [{ url: tab.url, filename: filenameFromUrl(tab.url) }] : [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const seen = new Set();
        const pdfs = [];
        const cleanName = (value) => {
          const text = String(value || "")
            .replace(/[<>:"\\|?*\x00-\x1f]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^\.+/, "");
          return /\.pdf$/i.test(text) ? text : `${text || "document"}.pdf`;
        };
        const nameFrom = (href, text) => {
          const label = String(text || "").trim();
          if (/\.pdf(?:$|[?#])/i.test(label)) return cleanName(label.replace(/[?#].*$/, ""));
          try {
            const url = new URL(href);
            const id = url.searchParams.get("dosyaId") || url.searchParams.get("fileId") || url.searchParams.get("id");
            const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
            if (/fileDownload/i.test(last) && id) return cleanName(label || `document_${id}.pdf`);
            return cleanName(last || label || (id ? `document_${id}.pdf` : "document.pdf"));
          } catch {
            return cleanName(label || "document.pdf");
          }
        };
        const looksDownloadUrl = (href) => {
          try {
            const url = new URL(href);
            return (
              /fileDownload/i.test(url.pathname) ||
              /dosyaId=|fileId=|download/i.test(url.search) ||
              /\/download(?:\/|$)/i.test(url.pathname)
            );
          } catch {
            return false;
          }
        };
        const surroundingText = (el) => {
          const row = el.closest("tr, li, .row, [role='row']");
          return `${el.textContent || ""} ${row?.textContent || ""}`;
        };

        for (const a of document.querySelectorAll("a[href]")) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          const text = surroundingText(a);
          const looksPdf =
            /\.pdf(?:$|[?#])/i.test(href) ||
            /\.pdf(?:\s|$)/i.test(text) ||
            looksDownloadUrl(href);
          if (!looksPdf) continue;
          if (!/^https?:|^blob:/i.test(href)) continue;
          seen.add(href);
          pdfs.push({ url: href, filename: nameFrom(href, text) });
        }
        for (const el of document.querySelectorAll("[onclick]")) {
          const raw = el.getAttribute("onclick") || "";
          const match = raw.match(/https?:\/\/[^'")\s]+fileDownload\.htm\?[^'")\s]+|(?:\/[^'")\s]+)?fileDownload\.htm\?[^'")\s]+/i);
          if (!match) continue;
          const href = new URL(match[0].replace(/&amp;/g, "&"), location.href).href;
          if (seen.has(href)) continue;
          const text = surroundingText(el);
          seen.add(href);
          pdfs.push({ url: href, filename: nameFrom(href, text) });
        }
        return pdfs;
      }
    });
    return result?.length ? result : fallback;
  } catch {
    return fallback;
  }
}

async function clickPagePdfControls() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const isVisible = (el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const hrefLooksDownload = (el) => {
          const href = el.href || el.getAttribute("href") || el.getAttribute("onclick") || "";
          return /fileDownload\.htm|dosyaId=|fileId=|\.pdf(?:$|[?#])/i.test(href);
        };
        const textLooksPdf = (el) => /\.pdf(?:\s|$)/i.test(el.textContent || "") || hrefLooksDownload(el);
        const canClick = (el) => {
          if (!isVisible(el) || !textLooksPdf(el)) return false;
          const tag = el.tagName.toLowerCase();
          return (
            tag === "a" ||
            tag === "button" ||
            el.hasAttribute("onclick") ||
            el.getAttribute("role") === "link" ||
            el.tabIndex >= 0 ||
            getComputedStyle(el).cursor === "pointer"
          );
        };
        const candidates = [];
        const seenText = new Set();
        for (const el of document.querySelectorAll("a, button, [onclick], [role='link'], [tabindex]")) {
          if (!canClick(el)) continue;
          const key = (el.textContent || "").trim();
          if (!key || seenText.has(key)) continue;
          seenText.add(key);
          candidates.push(el);
        }
        for (let i = 0; i < candidates.length; i += 1) {
          candidates[i].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          await sleep(350);
        }
        return candidates.length;
      }
    });
    return Number(result || 0);
  } catch {
    return 0;
  }
}

async function downloadPagePdfs() {
  const btn = $("download-pdfs-btn");
  btn.disabled = true;
  setPdfDownloadStatus("Scanning...");
  try {
    const pdfs = await collectPagePdfs();
    if (!pdfs.length) {
      setPdfDownloadStatus("Trying clicks...");
      const clicked = await clickPagePdfControls();
      setPdfDownloadStatus(clicked ? `Clicked ${clicked}` : "No PDFs");
      return;
    }
    if (pdfs.some((item) => needsPageClickDownload(item.url))) {
      setPdfDownloadStatus("Clicking links...");
      const clicked = await clickPagePdfControls();
      setPdfDownloadStatus(clicked ? `Clicked ${clicked}` : "No PDFs");
      return;
    }
    let ok = 0;
    for (let i = 0; i < pdfs.length; i += 1) {
      setPdfDownloadStatus(`${i + 1}/${pdfs.length}`);
      const item = pdfs[i];
      const res = await downloadUrl(item.url, item.filename || filenameFromUrl(item.url));
      if (res.ok) ok += 1;
      await new Promise((r) => setTimeout(r, 120));
    }
    setPdfDownloadStatus(`Started ${ok}/${pdfs.length}`);
  } catch (e) {
    setPdfDownloadStatus(e.message || "Failed");
  } finally {
    btn.disabled = false;
  }
}

async function saveHistory(meta, style, text) {
  const { history = [] } = await chrome.storage.local.get("history");
  history.unshift({ ts: Date.now(), style, text, meta });
  await chrome.storage.local.set({ history: history.slice(0, 200) });
}

$("cite-btn").addEventListener("click", cite);
$("copy-btn").addEventListener("click", copy);
$("download-pdfs-btn").addEventListener("click", downloadPagePdfs);
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
    const href = new URL(value).href;
    return (
      /\.pdf(?:$|[?#])/i.test(href) ||
      /pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/pdf\//i.test(href) ||
      /arxiv\.org\/pdf\//i.test(href)
    );
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

(async () => {
  const { lastStyle } = await chrome.storage.local.get("lastStyle");
  if (lastStyle) $("style").value = lastStyle;
  $("style").addEventListener("change", () => chrome.storage.local.set({ lastStyle: $("style").value }));
  cite();
})();
