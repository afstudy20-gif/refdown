export async function fetchCrossref(doi) {
  let m = null;
  // Crossref API
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=adycovs@gmail.com`;
    const r = await fetch(url);
    console.log("[refdown] crossref status", r.status, url);
    if (r.ok) m = (await r.json()).message;
  } catch (e) {
    console.warn("[refdown] crossref err", e);
  }
  // Fallback: doi.org CSL-JSON content negotiation
  if (!m) {
    try {
      const url = `https://doi.org/${encodeURIComponent(doi)}`;
      const r2 = await fetch(url, {
        headers: { Accept: "application/vnd.citationstyles.csl+json" },
        redirect: "follow"
      });
      console.log("[refdown] doi.org status", r2.status, r2.headers.get("content-type"));
      if (r2.ok && (r2.headers.get("content-type") || "").includes("json")) {
        m = await r2.json();
      }
    } catch (e) {
      console.warn("[refdown] doi.org err", e);
    }
  }
  if (!m) return null;
  const issuedParts =
    m.issued?.["date-parts"]?.[0] ||
    m["published-print"]?.["date-parts"]?.[0] ||
    m["published-online"]?.["date-parts"]?.[0] ||
    [];
  const typeMap = {
    "book": "book",
    "monograph": "book",
    "book-chapter": "chapter",
    "book-part": "chapter",
    "proceedings-article": "paper-conference",
    "dissertation": "thesis",
    "report": "report"
  };
  return {
    type: typeMap[m.type] || "article-journal",
    title: Array.isArray(m.title) ? m.title[0] : m.title,
    subtitle: Array.isArray(m.subtitle) ? m.subtitle[0] : m.subtitle,
    authors: (m.author || []).map((a) => ({
      given: a.given,
      family: a.family,
      orcid: a.ORCID,
      affiliation: a.affiliation?.[0]?.name
    })),
    editors: (m.editor || []).map((a) => ({ given: a.given, family: a.family })),
    issued: issuedParts.length
      ? { year: issuedParts[0], month: issuedParts[1] || null, day: issuedParts[2] || null }
      : null,
    containerTitle: Array.isArray(m["container-title"]) ? m["container-title"][0] : m["container-title"],
    shortContainerTitle: Array.isArray(m["short-container-title"]) ? m["short-container-title"][0] : null,
    publisher: m.publisher,
    publisherPlace: m["publisher-location"],
    volume: m.volume,
    issue: m.issue,
    pageNumber: m.page,
    issn: m.ISSN?.[0],
    isbn: m.ISBN?.[0],
    abstract: stripTags(m.abstract),
    language: m.language,
    license: m.license?.[0]?.URL,
    url: m.URL || (doi ? `https://doi.org/${doi}` : null),
    referenceCount: m["reference-count"]
  };
}

function stripTags(s) {
  if (!s) return null;
  return String(s).replace(/<[^>]+>/g, "").trim();
}

export async function fetchOpenLibrary(isbn) {
  const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) return null;
  const data = await r.json();
  const b = data[`ISBN:${isbn}`];
  if (!b) return null;
  return {
    type: "book",
    title: b.title,
    authors: (b.authors || []).map((a) => parseName(a.name)),
    issued: b.publish_date ? { year: parseInt(String(b.publish_date).match(/\d{4}/)?.[0], 10) || null } : null,
    publisher: b.publishers?.[0]?.name,
    url: b.url
  };
}

export async function fetchPubMed(pmid) {
  const r = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`);
  if (!r.ok) return null;
  const data = await r.json();
  const d = data.result?.[pmid];
  if (!d) return null;
  const year = parseInt(String(d.pubdate || "").match(/\d{4}/)?.[0], 10) || null;
  return {
    type: "article-journal",
    title: d.title?.replace(/\.$/, ""),
    authors: (d.authors || []).map((a) => parseName(a.name)),
    issued: year ? { year } : null,
    containerTitle: d.fulljournalname || d.source,
    volume: d.volume,
    issue: d.issue,
    pageNumber: d.pages,
    doi: (d.articleids || []).find((x) => x.idtype === "doi")?.value || null
  };
}

export async function fetchArxiv(id) {
  const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const xml = await r.text();
  const get = (tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
  const title = get("title");
  const summary = get("summary");
  const published = get("published");
  const authors = [...xml.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g)].map((m) => parseName(m[1]));
  const year = published?.slice(0, 4);
  return {
    type: "article",
    title,
    authors,
    issued: year ? { year: parseInt(year, 10) } : null,
    containerTitle: "arXiv",
    abstract: summary,
    url: `https://arxiv.org/abs/${id}`
  };
}

function parseName(raw) {
  if (!raw) return null;
  const r = raw.trim();
  if (r.includes(",")) {
    const [family, given] = r.split(",", 2).map((s) => s.trim());
    return { family, given };
  }
  const parts = r.split(/\s+/);
  if (parts.length === 1) return { literal: parts[0] };
  return { given: parts.slice(0, -1).join(" "), family: parts.at(-1) };
}
