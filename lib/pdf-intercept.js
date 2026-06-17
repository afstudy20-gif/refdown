export const READER_BASE = "https://arted.drtr.uk/reader";
export const RESOLVE_API = "https://arted.drtr.uk/api/pdf-resolve";

export const READER_PREFIXES = [
  "https://arted.drtr.uk/reader",
  "https://articleditor.drtr.uk/reader",
  "http://localhost:3000/reader",
];

export function isPdfUrl(value) {
  try {
    const url = new URL(value);
    const href = url.href;
    return (
      /\.pdf(?:$|[?#])/i.test(href) ||
      /pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/pdf\//i.test(href) ||
      /arxiv\.org\/pdf\//i.test(href) ||
      /sciencedirect\.com\/.*\/pdf\//i.test(href) ||
      /doi\.org\/10\./i.test(href) && /\/pdf/i.test(href)
    );
  } catch {
    return false;
  }
}

export function isReaderUrl(value) {
  return READER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function readerUrlFor(pdfUrl) {
  return `${READER_BASE}?url=${encodeURIComponent(pdfUrl)}`;
}

export function shouldInterceptPdf(value) {
  return isPdfUrl(value) && !isReaderUrl(value);
}