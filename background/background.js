import { fetchCrossref, fetchOpenLibrary, fetchPubMed, fetchArxiv } from "../lib/providers.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cite-page",
    title: "Cite this page with RefDown",
    contexts: ["page", "selection", "link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "cite-page") {
    chrome.action.openPopup?.();
  }
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "cite-current-page") chrome.action.openPopup?.();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "enrich") {
    enrich(msg.meta).then(sendResponse).catch((e) => sendResponse({ ...msg.meta, error: e.message }));
    return true;
  }
});

/**
 * Merge enrichment data, preferring fresh (API) truthy values over old (scraped) ones.
 * Arrays must be non-empty to override.
 */
function mergePreferTruthy(base, fresh) {
  const out = { ...base };
  for (const [k, v] of Object.entries(fresh)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

async function enrich(meta) {
  let out = { ...meta, _enrichLog: [] };
  try {
    if (out.doi) {
      out._enrichLog.push(`crossref:${out.doi}`);
      const cr = await fetchCrossref(out.doi);
      if (cr) {
        out._enrichLog.push("crossref:ok");
        out = mergePreferTruthy(out, { ...cr, doi: out.doi });
      } else {
        out._enrichLog.push("crossref:null");
      }
    }
    if (out.pmid) {
      const pm = await fetchPubMed(out.pmid);
      if (pm) {
        out = mergePreferTruthy(out, { ...pm, pmid: out.pmid });
        // PubMed often exposes DOI we didn't have — do a second-pass Crossref fetch
        if (pm.doi && !meta.doi) {
          const cr = await fetchCrossref(pm.doi);
          if (cr) out = mergePreferTruthy(out, { ...cr, doi: pm.doi });
        }
      }
    }
    if (out.arxivId) {
      const ax = await fetchArxiv(out.arxivId);
      if (ax) out = mergePreferTruthy(out, { ...ax, arxivId: out.arxivId });
    }
    if (out.isbn) {
      const ol = await fetchOpenLibrary(out.isbn);
      if (ol) out = mergePreferTruthy(out, { ...ol, isbn: out.isbn });
    }
  } catch (e) {
    out._enrichLog.push(`error:${e.message}`);
    console.warn("enrich failed", e);
  }
  console.log("[refdown] enrich log:", out._enrichLog);
  return out;
}
