export function toBibTeX(m) {
  const key = bibKey(m);
  const type = m.type === "book" ? "book" : m.type === "article-journal" ? "article" : "misc";
  const fields = {
    title: m.title,
    author: (m.authors || []).map((a) => a.literal || `${a.family || ""}, ${a.given || ""}`.replace(/, $/, "")).join(" and "),
    year: m.issued?.year,
    journal: m.containerTitle,
    publisher: m.publisher,
    volume: m.volume,
    number: m.issue,
    pages: m.pageNumber,
    doi: m.doi,
    url: m.url || m.pageUrl,
    note: m.pmid ? `PMID: ${m.pmid}` : null,
    isbn: m.isbn
  };
  const body = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${String(v).replace(/[{}]/g, "")}}`)
    .join(",\n");
  return `@${type}{${key},\n${body}\n}\n`;
}

export function toRIS(m) {
  const type = m.type === "book" ? "BOOK" : m.type === "article-journal" ? "JOUR" : "ELEC";
  const lines = [`TY  - ${type}`];
  for (const a of m.authors || []) {
    const name = a.literal || `${a.family || ""}, ${a.given || ""}`.replace(/, $/, "");
    lines.push(`AU  - ${name}`);
  }
  if (m.title) lines.push(`TI  - ${m.title}`);
  if (m.containerTitle) lines.push(`JO  - ${m.containerTitle}`);
  if (m.issued?.year) lines.push(`PY  - ${m.issued.year}`);
  if (m.volume) lines.push(`VL  - ${m.volume}`);
  if (m.issue) lines.push(`IS  - ${m.issue}`);
  if (m.pageNumber) {
    const [sp, ep] = String(m.pageNumber).split(/[-–]/);
    if (sp) lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);
  }
  if (m.publisher) lines.push(`PB  - ${m.publisher}`);
  if (m.doi) lines.push(`DO  - ${m.doi}`);
  if (m.url || m.pageUrl) lines.push(`UR  - ${m.url || m.pageUrl}`);
  if (m.abstract) lines.push(`AB  - ${m.abstract}`);
  if (m.isbn) lines.push(`SN  - ${m.isbn}`);
  if (m.pmid) lines.push(`AN  - ${m.pmid}`);
  lines.push("ER  - ");
  return lines.join("\n") + "\n";
}

function bibKey(m) {
  const a = (m.authors?.[0]?.family || "ref").toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = m.issued?.year || "nd";
  const t = (m.title || "").split(/\s+/).find((w) => w.length > 3) || "";
  return `${a}${y}${t.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 32);
}
