import { fetchCrossref, fetchOpenLibrary, fetchPubMed, fetchPmcIds, fetchArxiv } from "../lib/providers.js";

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
  if (msg.type === "find-ae-tab") {
    findAETab().then(sendResponse);
    return true;
  }
  if (msg.type === "list-ae-projects") {
    listAEProjects().then(sendResponse);
    return true;
  }
  if (msg.type === "add-ref-to-ae") {
    addRefToAE(msg.projectId, msg.refData).then(sendResponse);
    return true;
  }
});

// --- ArticleEditor Integration ---

const AE_URLS = [
  "https://arted.drtr.uk",
  "https://articleditor.drtr.uk",
  "http://localhost:3000"
];

async function findAETab() {
  for (const base of AE_URLS) {
    const tabs = await chrome.tabs.query({ url: base + "/*" });
    if (tabs.length > 0) return { tabId: tabs[0].id, url: tabs[0].url };
  }
  return null;
}

async function ensureAETab() {
  const existing = await findAETab();
  if (existing) return existing;
  const tab = await chrome.tabs.create({ url: AE_URLS[0], active: false });
  await new Promise(resolve => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise(r => setTimeout(r, 1500));
  return { tabId: tab.id, url: tab.url };
}

async function listAEProjects() {
  const tab = await findAETab();
  if (!tab) return { projects: null, noTab: true };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      func: async () => {
        if (!window.__aeReady) return null;
        return await window.__aeListProjects();
      },
      world: "MAIN"
    });
    return { projects: result };
  } catch (e) {
    return { projects: null, error: e.message };
  }
}

async function addRefToAE(projectId, refData) {
  const tab = await ensureAETab();
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      func: async (pid, data) => {
        if (!window.__aeReady) return { success: false, error: "ArticleEditor not ready" };
        return await window.__aeAddRefToProject(pid, data);
      },
      args: [projectId, refData],
      world: "MAIN"
    });
    return result || { success: false, error: "No response" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

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
    if (out.pmcid) {
      out._enrichLog.push(`pmc:${out.pmcid}`);
      const ids = await fetchPmcIds(out.pmcid);
      if (ids) {
        out._enrichLog.push("pmc:ok");
        out = mergePreferTruthy(out, ids);
      } else {
        out._enrichLog.push("pmc:null");
      }
    }
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
      const hadDoiBeforePubMed = Boolean(out.doi);
      const pm = await fetchPubMed(out.pmid);
      if (pm) {
        out = mergePreferTruthy(out, { ...pm, pmid: out.pmid });
        // PubMed often exposes DOI we didn't have — do a second-pass Crossref fetch
        if (pm.doi && !hadDoiBeforePubMed) {
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
