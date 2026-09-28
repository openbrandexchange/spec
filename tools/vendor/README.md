# Vendored third-party files

| File | What | Licence |
|---|---|---|
| `redoc.standalone.js` | the Redoc 2.5.4 viewer that Redocly CLI's `build-docs` pages load; served from `site/assets/` instead of Redocly's CDN | MIT (`redoc.LICENSE`); bundled libraries listed in `redoc.standalone.js.LICENSE.txt` |

`npm run build:site` checks the file against the SRI hash that Redocly CLI writes into the pages. After upgrading `@redocly/cli`, run `node tools/build-site.mjs --update-redoc` (needs network) and commit the new files.
