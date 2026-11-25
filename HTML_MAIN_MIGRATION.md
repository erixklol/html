# Existing `html-main/` Bunny upload

The user uploaded the HTML repository into `https://gurtsgames.b-cdn.net/html-main/`. This workflow verifies the public files; it never uploads, deletes, or changes Bunny Storage.

Run `node scripts/verify-html-main.mjs` from this repository. It matches the 854 catalog IDs to their exact source filenames, fetches the corresponding public CDN HTML with redirects disabled, checks HTTP 200, `text/html`, the existing 100 KB limit, and SHA-256 against the repository's normalized source bytes. It checks static relative assets where they resolve under `html-main/`, and excludes known broken games. Dynamic and external dependencies are flagged for browser gameplay testing. The command uses bounded parallel requests and produces:

- `bunny-upload-results/html-main-manifest-proposal.json`: exact CDN URLs, HTML hashes, and checked relative asset paths suitable for the Gurt's Games server-side hosting check.
- `bunny-upload-results/html-main-verification-report.json`: one status and reason for every catalog ID. The checked snapshot is also committed at `catalog/html-main-verification-report.json`.

The manual **Upload reviewed games to Bunny CDN** workflow now has a separate `verify-html-main` mode. It needs no storage secret, does no upload, and saves the report and proposal as an artifact. The existing `upload` mode and `all` batch remain restricted to approved packages in `bunny-packages/approved.json`.

## Initial result

| Result | Games |
| --- | ---: |
| HTML and checked local assets verified | 740 |
| CDN HTML differs from reviewed source | 54 |
| Invalid or incomplete source HTML | 28 |
| Source exceeds 100 KB review limit | 19 |
| Dependency path needs review | 5 |
| Required static asset missing | 4 |
| Known broken game | 4 |
| **Total catalog games** | **854** |

`gn-102` passes the HTML check; its `../favicon.png` is an optional icon, while its required game scripts are external and still need a browser gameplay check. `gn-101`'s raw HTML references `/js/main.js`, which returned 404 on Bunny; the raw file is excluded. Its previously prepared `games/gn-101/index.html` candidate remains in the website and must pass its own server check. The 740 verified HTML files are not a claim that every external script or game mechanic works, and they are not a new redistribution-rights approval.

To update the website after a later CDN upload, rerun verification, inspect the report, then copy the verified proposal to `erixklol/gurtsgames/src/lib/gn-html-main-deployments.json` in a reviewed PR. The website rechecks the HTML hash and listed assets before Play appears. Do not copy failed rows into the manifest or turn on a blanket ID-derived URL.
