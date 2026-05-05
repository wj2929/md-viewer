# Notices

This project is licensed under the MIT License. See `LICENSE`.

## Third-party runtime components

The application depends on open-source packages listed in `package.json` and `package-lock.json`.
Important runtime dependencies include:

| Component | License | Purpose |
|---|---|---|
| Electron | MIT | Desktop application runtime |
| React | MIT | Renderer UI |
| Excalidraw | MIT | Excalidraw scene rendering |
| Mermaid | MIT | Mermaid chart rendering |
| ECharts | Apache-2.0 | Chart rendering |
| KaTeX | MIT | Math formula rendering |
| Markmap | MIT | Mind map rendering |
| hpcc-js/wasm-graphviz | Apache-2.0 | Graphviz DOT rendering |
| AntV Infographic | MIT | Infographic rendering |
| DOMPurify | MPL-2.0 OR Apache-2.0 | HTML sanitization |
| docx | MIT | DOCX generation helpers |

## Bundled assets

| Asset | Notes |
|---|---|
| `src/renderer/public/drawio-viewer.min.js` | Bundled DrawIO/diagrams.net viewer asset used for DrawIO preview. Confirm the source version and upstream license before public release. |
| `resources/reference.docx` | DOCX template used by export logic. Confirm the document source and redistribution rights before public release. |
| `resources/reference-gongwen.docx` | DOCX template used by export logic. Confirm the document source and redistribution rights before public release. |
| `resources/icon.*` | Application icons. Confirm original artwork ownership before public release. |

## Release checklist

- Keep `package-lock.json` pinned to public registries.
- Do not commit private document fixtures, local absolute paths, or internal execution notes.
- Verify bundled binary assets and templates have redistribution rights before publishing a release.
