(() => {
  const m = scrape();
  return m;

  function scrape() {
    const meta = {
      type: "webpage",
      title: null,
      authors: [],
      issued: null,
      containerTitle: null,
      publisher: null,
      siteName: null,
      doi: null,
      isbn: null,
      pmid: null,
      arxivId: null,
      url: location.href,
      accessed: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
      lang: document.documentElement.lang || null,
      pageNumber: null,
      volume: null,
      issue: null,
      abstract: null
    };

    const get = (sel, attr = "content") => document.querySelector(sel)?.getAttribute(attr) || null;
    const getAll = (sel, attr = "content") => [...document.querySelectorAll(sel)].map((el) => el.getAttribute(attr)).filter(Boolean);

    const citTitle = get('meta[name="citation_title"]');
    const ogTitle = get('meta[property="og:title"]');
    const dcTitle = get('meta[name="DC.title"]') || get('meta[name="dc.title"]');
    const siteName = get('meta[property="og:site_name"]') || null;
    meta.title = cleanTitle(citTitle || dcTitle || ogTitle || document.title || null, siteName);

    const citAuthors = getAll('meta[name="citation_author"]');
    const dcAuthors = getAll('meta[name="DC.creator"]').concat(getAll('meta[name="dc.creator"]'));
    const articleAuthors = getAll('meta[property="article:author"]').concat(getAll('meta[name="author"]'));
    const rawAuthors = (citAuthors.length ? citAuthors : dcAuthors.length ? dcAuthors : articleAuthors);
    meta.authors = rawAuthors.map(parseAuthor);

    const citDate = get('meta[name="citation_publication_date"]') || get('meta[name="citation_date"]') || get('meta[name="citation_online_date"]') || get('meta[name="prism.publicationDate"]');
    const dcDate = get('meta[name="DC.date"]') || get('meta[name="dc.date"]') || get('meta[name="DC.date.issued"]');
    const ogDate = get('meta[property="article:published_time"]') || get('meta[name="date"]') || get('meta[name="pubdate"]') || get('meta[itemprop="datePublished"]');
    const timeEl = document.querySelector("time[datetime]")?.getAttribute("datetime") || document.querySelector("time[pubdate]")?.getAttribute("datetime");
    meta.issued = parseDate(citDate || dcDate || ogDate || timeEl);

    meta.containerTitle = get('meta[name="citation_journal_title"]') || get('meta[name="prism.publicationName"]') || null;
    meta.publisher = get('meta[name="citation_publisher"]') || get('meta[name="DC.publisher"]') || null;
    meta.siteName = get('meta[property="og:site_name"]') || null;
    meta.volume = get('meta[name="citation_volume"]');
    meta.issue = get('meta[name="citation_issue"]');
    const firstPage = get('meta[name="citation_firstpage"]');
    const lastPage = get('meta[name="citation_lastpage"]');
    if (firstPage) meta.pageNumber = lastPage ? `${firstPage}-${lastPage}` : firstPage;
    meta.abstract = get('meta[name="citation_abstract"]') || get('meta[name="description"]') || get('meta[property="og:description"]');

    meta.doi = extractDoi();
    meta.isbn = get('meta[name="citation_isbn"]') || extractIsbn();
    meta.pmid = get('meta[name="citation_pmid"]') || extractPmid();
    meta.arxivId = get('meta[name="citation_arxiv_id"]') || extractArxiv();

    const jsonLd = readJsonLd();
    if (jsonLd) mergeJsonLd(meta, jsonLd);

    if (meta.doi || meta.containerTitle) meta.type = "article-journal";
    else if (meta.isbn) meta.type = "book";
    else if (meta.arxivId) meta.type = "article";

    return meta;
  }

  function cleanTitle(t, site) {
    if (!t) return null;
    let s = String(t).trim();
    // Strip trailing site suffix: " | Site", " - Site", " — Site"
    const sep = /[|\-–—·•:]\s+[^|\-–—·•:]+$/;
    if (site) {
      const escSite = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\s*[|\\-–—·•:]\\s*${escSite}\\s*$`, "i");
      s = s.replace(re, "");
    } else if (sep.test(s) && s.length > 40) {
      // long titles with separator: drop trailing segment if it looks like site
      s = s.replace(sep, "");
    }
    return s.trim();
  }

  function parseAuthor(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (raw.includes(",")) {
      const [family, given] = raw.split(",", 2).map((s) => s.trim());
      return { family, given };
    }
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return { literal: parts[0] };
    return { given: parts.slice(0, -1).join(" "), family: parts.at(-1) };
  }

  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{4})(?:[-\/](\d{1,2}))?(?:[-\/](\d{1,2}))?/);
    if (!m) return null;
    return {
      year: parseInt(m[1], 10),
      month: m[2] ? parseInt(m[2], 10) : null,
      day: m[3] ? parseInt(m[3], 10) : null
    };
  }

  function extractDoi() {
    const meta = document.querySelector('meta[name="citation_doi"], meta[name="DC.identifier.doi"], meta[scheme="doi"]')?.content;
    if (meta) return cleanDoi(meta);
    const m = (location.href + " " + document.body.innerText.slice(0, 5000)).match(/10\.\d{4,9}\/[^\s"<>]+/);
    return m ? cleanDoi(m[0]) : null;
  }
  function cleanDoi(d) { return d.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, "").replace(/[.,;]+$/, ""); }

  function extractIsbn() {
    const m = document.body.innerText.match(/\b97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d\b/);
    return m ? m[0].replace(/[-\s]/g, "") : null;
  }

  function extractPmid() {
    const u = location.href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
    return u ? u[1] : null;
  }

  function extractArxiv() {
    const u = location.href.match(/arxiv\.org\/(?:abs|pdf)\/([^\s\/?#]+)/);
    return u ? u[1].replace(/\.pdf$/, "") : null;
  }

  function readJsonLd() {
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(el.textContent);
        const arr = Array.isArray(data) ? data : [data];
        for (const d of arr) {
          const t = d["@type"];
          if (t && /Article|ScholarlyArticle|NewsArticle|BlogPosting|Book|WebPage/.test(String(t))) return d;
        }
      } catch {}
    }
    return null;
  }

  function mergeJsonLd(meta, d) {
    if (!meta.title && d.headline) meta.title = d.headline;
    if (!meta.title && d.name) meta.title = d.name;
    if (!meta.authors.length && d.author) {
      const arr = Array.isArray(d.author) ? d.author : [d.author];
      meta.authors = arr.map((a) => (typeof a === "string" ? parseAuthor(a) : parseAuthor(a.name))).filter(Boolean);
    }
    if (!meta.issued && (d.datePublished || d.dateCreated)) meta.issued = parseDate(d.datePublished || d.dateCreated);
    if (!meta.publisher && d.publisher) meta.publisher = typeof d.publisher === "string" ? d.publisher : d.publisher.name;
    if (!meta.containerTitle && d.isPartOf?.name) meta.containerTitle = d.isPartOf.name;
  }
})();
