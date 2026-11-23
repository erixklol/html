# GN Math → Bunny migration review (2026-11-22)

## Scope and result

The pinned `catalog/zones.json` snapshot has 855 rows, of which 854 map to game IDs. The `erixklol/html` root has 949 HTML-like files; 95 are not mapped by this catalog snapshot. `node scripts/catalog-audit.mjs` generates the complete ID-to-source inventory, source hashes, duplicate flags, missing/static/dynamic dependency findings, and rights status as an artifact. The categories are: **1 ready**, **568 missing assets**, **257 separate technical/rightsholder review**, and **28 failed source checks**. All 853 unapproved catalog games need game-specific rights review; the structural categories do not waive that requirement. One duplicate-content game was detected.

One historical CDN file, `gn-101`, returned HTTP 200 and the recorded SHA-256 in a public GET. That is **network verification only**. Its original game's redistribution permission has not been established, so the existing package and CDN file are preserved but removed from the future upload approval list. No Bunny upload or site deployment was triggered by this review.

## Permission boundary

The user-supplied [GN Math About page](https://gnmaths.com/about/) describes that site's curated library; it does not contain the claimed Discord mirror permission, name these 854 games, or grant third-party rights. The original [GN Math HTML](https://github.com/gn-math/html) and [assets](https://github.com/gn-math/assets) repository roots have no repository-wide license file. A GN Math permission statement, if supplied, could cover GN Math's own code and assets within its stated scope; it cannot alone license code, artwork, music, trademarks, or game files owned by other developers. Credit is preserved for all approved packages, but credit itself is not permission.

## Ten-game pilot

| Catalog ID | Game | Result | Evidence and dependency finding |
| --- | --- | --- | --- |
| `gn-114` | 2048 AI | **Ready for manual upload** | GN source `114-fix2.html` points to [ovolve/2048-AI](https://github.com/ovolve/2048-AI), which includes an [MIT license](https://github.com/ovolve/2048-AI/blob/master/LICENSE.txt). Rebuilt from pinned commit `226be513371ce2493843b2485c280e2389ef7dad` with its scripts/styles, license, and author credits; removed optional analytics, fonts, and sharing. 14 reviewed package files. Local JS syntax, hash, dependency, and uploader preflight tests pass. Live game play and CDN launch remain unverified. |
| `gn-101` | Ninja vs EvilCorp | Existing CDN bytes verified; **rights review** | [Original game repository](https://github.com/js13kGames/ninja-vs-evilcorp) did not provide a clear redistribution license in this review. Existing CDN file is preserved, but excluded from future approved uploads pending author permission or a license. |
| `gn-180` | n-gon | Separate technical review | [Original project](https://github.com/landgreen/n-gon) is GPL-3.0, but GN's HTML needs many absent assets, exceeds the current 64-asset review limit, and needs a source/notice compliance plan. |
| `gn-313` | Minesweeper Mania | Rights review | GN source loads assets from [yrgen73/mineSW](https://github.com/yrgen73/mineSW); no project redistribution license was established. |
| `gn-317` | sandspiel | Missing assets and provenance | [Original project](https://github.com/MaxBittker/sandspiel) has an MIT license; GN's modified bundle points to another asset host and has missing files. Original license alone does not verify that bundle's assets. |
| `gn-440` | Celeste PICO | Rights review | The apparent CC0 notice belongs to the PICO-8 exporter shell, not necessarily the game cartridge, artwork, or audio. Dynamic loading needs review. |
| `gn-473` | Spacebar Clicker | Rights review | Dynamic loading and external URLs; no game-specific reuse grant was established. |
| `gn-506` | Pokémon Emerald | Separate permission required | Commercial game content and dynamic loading; no redistribution permission was established. |
| `gn-592` | Pac Man World | Separate permission required | Commercial game content and dynamic loading; no redistribution permission was established. |
| `gn-623` | Celeste | Missing assets and rights review | The embedded MIT notice applies to a framework; this package has missing assets and no verified license for the game content. |

The other 844 catalog games remain in the complete machine-readable audit rather than being silently approved. The `approved.json` list contains only `gn-114`; batch 10/50/100/all currently each selects one new eligible game. Future packages can use the same manifest/preflight/verification workflow, with individual evidence and assets reviewed before addition.

## Evidence still needed

- The **actual Discord permission statement**: permalink or screenshot with author, date, exact wording, and confirmation the author can authorize the GN-owned material. The About page is not that statement.
- For each third-party game: original source or author permission covering redistribution/hosting of the **specific game build and its code, art, audio, and other assets**. Where an open license applies, retain its notices and meet any source-sharing or other conditions.
- For technically blocked games: all missing files, a reviewed source-to-asset map, and a browser startup check in the protected player. Games exceeding the site's current limits need a separately reviewed approach.

After a manual Bunny upload, use the verified manifest proposal to create a separate site PR; do not enable new URLs before public hash verification and browser testing. Existing GitHub Pages fallback is unchanged.
