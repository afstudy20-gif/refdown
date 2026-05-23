// v0: hand-rolled formatters for top styles.
// v1 plan: swap to citeproc-js + bundled CSL files.

export async function formatCitation(meta, style) {
  const raw = pick(style)(meta);
  return tidy(raw);
}

function pick(style) {
  switch (style) {
    case "apa": return apa;
    case "modern-language-association": return mla;
    case "chicago-author-date": return chicagoAuthorDate;
    case "chicago-note-bibliography": return chicagoNotes;
    case "harvard-cite-them-right": return harvard;
    case "vancouver": return vancouver;
    case "ieee": return ieee;
    case "american-medical-association": return ama;
    default: return apa;
  }
}

function tidy(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*\./g, ".")          // duplicate dots
    .replace(/^\s*[.,;:]\s*/, "")          // leading punctuation
    .replace(/\(\s*\)/g, "")               // empty parens
    .replace(/"\s*"/g, "")                 // empty quotes
    .replace(/\bvol\.\s*,/gi, "")
    .replace(/\bno\.\s*,/gi, "")
    .replace(/\bpp\.\s*,/gi, "")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/Published n\.d\.\.?/g, "")
    .trim();
}

const lastFirst = (a) => a.literal || `${a.family || ""}, ${initials(a.given)}`.replace(/, $/, "");
const firstLast = (a) => a.literal || `${a.given || ""} ${a.family || ""}`.trim();
const initials = (g) => (g || "").split(/[\s.-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + ".").join(" ");
const joinAuthorsAPA = (auths) => {
  if (!auths?.length) return "";
  const names = auths.map(lastFirst);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  if (names.length <= 20) return names.slice(0, -1).join(", ") + ", & " + names.at(-1);
  return names.slice(0, 19).join(", ") + ", … " + names.at(-1);
};
const year = (m) => m.issued?.year || "n.d.";
const accessed = (m) => {
  const a = m.accessed;
  if (!a) return "";
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[a.month - 1]} ${a.day}, ${a.year}`;
};
const urlOrDoi = (m) => (m.doi ? `https://doi.org/${m.doi}` : m.url || m.pageUrl || "");
const italic = (s) => s; // plain text; UI may upgrade
const dot = (s) => (s && !/[.!?]$/.test(s) ? s + "." : s);

function apa(m) {
  const a = joinAuthorsAPA(m.authors);
  const t = dot(m.title || "");
  const yr = `(${year(m)}).`;
  if (m.type === "article-journal" && m.containerTitle) {
    const vol = m.volume ? ` ${m.volume}` : "";
    const iss = m.issue ? `(${m.issue})` : "";
    const pp = m.pageNumber ? `, ${m.pageNumber}` : "";
    return `${a} ${yr} ${t} ${italic(m.containerTitle)},${vol}${iss}${pp}. ${urlOrDoi(m)}`.trim();
  }
  if (m.type === "book") {
    return `${a} ${yr} ${italic(t)} ${m.publisher || ""}. ${urlOrDoi(m)}`.trim();
  }
  return `${a} ${yr} ${italic(t)} ${m.siteName || m.containerTitle || ""}. Retrieved ${accessed(m)}, from ${urlOrDoi(m)}`.trim();
}

function mla(m) {
  const a = m.authors?.length ? (m.authors.length > 2 ? `${m.authors[0].family}, ${m.authors[0].given}, et al.` : m.authors.map((x, i) => i === 0 ? lastFirst(x) : firstLast(x)).join(", and ")) : "";
  const t = `"${m.title || ""}."`;
  const src = m.containerTitle || m.siteName || m.publisher || "";
  if (m.type === "webpage") {
    return `${a} ${t} ${italic(src)}, ${m.issued?.year || "n.d."}, ${urlOrDoi(m)}. Accessed ${accessed(m)}.`.replace(/\s+/g, " ").trim();
  }
  const vol = m.volume ? ` vol. ${m.volume},` : "";
  const iss = m.issue ? ` no. ${m.issue},` : "";
  const yr = m.issued?.year ? ` ${m.issued.year},` : "";
  const pp = m.pageNumber ? ` pp. ${m.pageNumber},` : "";
  return `${a} ${t} ${italic(src)},${vol}${iss}${yr}${pp} ${urlOrDoi(m)}. Accessed ${accessed(m)}.`.replace(/\s+/g, " ").trim();
}

function chicagoAuthorDate(m) {
  const a = joinAuthorsAPA(m.authors).replace(/, &/, " and");
  if (m.type === "article-journal") {
    return `${a}. ${year(m)}. "${m.title}." ${italic(m.containerTitle || "")} ${m.volume || ""}${m.issue ? ` (${m.issue})` : ""}: ${m.pageNumber || ""}. ${urlOrDoi(m)}`.trim();
  }
  return `${a}. ${year(m)}. "${m.title}." ${italic(m.siteName || "")}. ${urlOrDoi(m)}.`.trim();
}

function chicagoNotes(m) {
  const a = m.authors?.map(firstLast).join(", ") || "";
  return `${a}, "${m.title}," ${italic(m.containerTitle || m.siteName || "")} (${year(m)}), ${urlOrDoi(m)}.`;
}

function harvard(m) {
  const a = m.authors?.map(lastFirst).join(", ") || "";
  return `${a} (${year(m)}) '${m.title}', ${italic(m.containerTitle || m.siteName || "")}${m.volume ? `, ${m.volume}` : ""}${m.issue ? `(${m.issue})` : ""}${m.pageNumber ? `, pp. ${m.pageNumber}` : ""}. Available at: ${urlOrDoi(m)} (Accessed: ${accessed(m)}).`;
}

function vancouver(m) {
  const a = (m.authors || []).slice(0, 6).map((x) => `${x.family || ""} ${initials(x.given).replace(/\./g, "")}`).join(", ");
  const etal = (m.authors?.length || 0) > 6 ? ", et al" : "";
  if (m.type === "webpage") {
    return `${a}${etal}. ${m.title} [Internet]. ${m.siteName || ""}; ${year(m)} [cited ${accessed(m)}]. Available from: ${urlOrDoi(m)}`.trim();
  }
  return `${a}${etal}. ${m.title}. ${m.containerTitle || ""}. ${year(m)}${m.volume ? `;${m.volume}` : ""}${m.issue ? `(${m.issue})` : ""}${m.pageNumber ? `:${m.pageNumber}` : ""}. ${m.doi ? `doi:${m.doi}` : urlOrDoi(m)}`.trim();
}

function ieee(m) {
  const a = (m.authors || []).map((x) => `${initials(x.given)} ${x.family || ""}`).join(", ");
  if (m.type === "webpage") {
    return `${a}, "${m.title}," ${italic(m.siteName || "")}, ${year(m)}. [Online]. Available: ${urlOrDoi(m)}. [Accessed: ${accessed(m)}].`;
  }
  return `${a}, "${m.title}," ${italic(m.containerTitle || "")}, vol. ${m.volume || ""}, no. ${m.issue || ""}, pp. ${m.pageNumber || ""}, ${year(m)}. ${m.doi ? `doi: ${m.doi}` : urlOrDoi(m)}.`;
}

function ama(m) {
  const a = (m.authors || []).slice(0, 6).map((x) => `${x.family || ""} ${initials(x.given).replace(/\./g, "")}`).join(", ");
  if (m.type === "webpage") {
    return `${a}. ${m.title}. ${m.siteName || ""}. Published ${year(m)}. Accessed ${accessed(m)}. ${urlOrDoi(m)}`.trim();
  }
  return `${a}. ${m.title}. ${italic(m.containerTitle || "")}. ${year(m)};${m.volume || ""}${m.issue ? `(${m.issue})` : ""}:${m.pageNumber || ""}. ${m.doi ? `doi:${m.doi}` : ""}`.trim();
}
