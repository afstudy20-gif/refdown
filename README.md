# RefDown

One-click citation generator. Chrome MV3 extension. Cites any web page, DOI, ISBN, PubMed ID, arXiv ID. Local-first, no login, all CSL styles.

## Status

v0.1 — scaffold. Hand-rolled formatters for top 8 styles. v1 plan: bundle `citeproc-js` + CSL.

## Install (dev)

1. `chrome://extensions` → enable Developer mode
2. Load unpacked → select this folder
3. Pin RefDown to toolbar
4. Click icon on any page → pick style → **Cite this page**

## How it works

1. Content script (`content/scraper.js`) reads metadata from current page:
   - Highwire tags (`citation_*`) — PubMed, journals
   - OpenGraph + Dublin Core
   - JSON-LD `Article` / `ScholarlyArticle` / `Book`
   - DOI / ISBN / PMID / arXiv ID detection
2. Background SW (`background/background.js`) enriches via API:
   - DOI → Crossref
   - ISBN → OpenLibrary
   - PMID → NCBI E-utilities
   - arXiv → arXiv API
3. Popup formats CSL-JSON-like meta into chosen style.
4. Export: clipboard, `.bib`, `.ris`.

## Layout

```
manifest.json
background/background.js
content/scraper.js
popup/{popup.html,popup.js,popup.css}
lib/{format.js,providers.js,export.js}
icons/  (add PNGs: 16,32,48,128)
```

## Roadmap

- v0.2: citeproc-js + CSL style picker (search 10k styles)
- v0.3: collections / folders, batch export
- v0.4: PDF metadata extraction
- v0.5: Zotero connector protocol compat
- v0.6: selection → quoted citation with locator (page/section)
- v1.0: Firefox MV3 port, options page (default style, locale, custom CSL)

## License

MIT
