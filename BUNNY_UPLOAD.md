# Manual Bunny CDN migration

`catalog/zones.json` maps game IDs to source HTML. `node scripts/catalog-audit.mjs` produces `bunny-upload-results/bunny-migration-report.json` with every mapped ID, source hash, duplicate/dependency flags, rights status, structural standalone flag, referenced-repository groups, and independent CDN observations. A referenced repository may be a mirror or asset host, not the original developer; groups are research leads, never automatic license approvals. `MIGRATION_REPORT.md` summarizes the review. The inventory is not a license grant.

Only packages in `bunny-packages/approved.json` can be selected for upload. The uploader checks the catalog ID-to-source mapping, source/package hashes, specific rights evidence, bundled license for open-license games, local assets, size limits, and symlinks. `scripts/prepare-2048.mjs` reconstructs the first newly reviewed game, `gn-114`, from a pinned commit of the MIT-licensed original project. The existing `gn-101` package and public CDN file remain, but it is excluded from future uploads pending permission evidence. GN Math's catalog and generic credits do not grant rights to third-party games.

## Configure GitHub Actions in erixklol/html

Under **Settings → Secrets and variables → Actions**, configure:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `BUNNY_STORAGE_PASSWORD` | Bunny Storage Zone password. Repository secrets are not shared with `erixklol/gurtsgames`. |
| Variable | `BUNNY_STORAGE_ZONE` | Actual Storage Zone name, for example `gurtgames`. |
| Variable | `BUNNY_STORAGE_ENDPOINT` | Regional HTTPS endpoint from Storage Zone → Access, for example `https://ny.storage.bunnycdn.com`. |

The password is sent only as an `AccessKey` header to an allowlisted Bunny Storage hostname. Confirm the Storage Zone maps to `https://gurtsgames.b-cdn.net/`. See [Bunny Storage HTTP documentation](https://bunny.net/docs/storage/http).

After merging the PR, open **Actions → Upload reviewed games to Bunny CDN → Run workflow**. The default `plan` mode makes no upload. Review its artifact first. Then select `upload` explicitly, with a batch of `10`, `50`, `100`, or `all`. Batch size limits eligible packages, not all catalog games. No schedule or push event triggers an upload.

The artifact contains source inventory, per-game migration report, upload report, and a website manifest proposal. A new game enters the proposal only after public CDN HTML and every packaged asset match the reviewed hash and content type. The workflow cannot edit `gurtsgames` or publish a game there. Create a separate reviewed PR to add verified new IDs to `erixklol/gurtsgames/src/lib/gn-bunny-deployments.json`; the website then performs its own launch checks. Existing GitHub Pages hosts remain available.

If a run fails, use `lastCompleted` as `resume_after` on the next manual run. Already matching CDN files are skipped. Different bytes at an existing destination stop the run; it never overwrites them or sends DELETE. A propagation delay may require a later verification run.

## Review additional games

1. Find the exact game's code, art, audio, and font licenses, or written authorization from every relevant rights holder. Record a direct evidence URL and description. A public repository or GN Math listing alone is insufficient.
2. Verify local dependencies and gameplay. Package `index.html` plus all required relative files under `bunny-packages/gn-<id>/`. Resolve external/root-relative references and remove optional tracking. Preserve licenses and creator credits. No symlinks; HTML at most 100 KB; at most 64 assets, each at most 25 MB, matching the website's [PR #13 checks](https://github.com/erixklol/gurtsgames/pull/13).
3. Add the exact catalog source name and SHA-256, `rightsEvidence`, package hashes, and dependency review to `approved.json`. Run `node --test tests/bunny-upload.test.mjs`, `node scripts/catalog-audit.mjs`, and `node scripts/bunny-upload.mjs --mode=plan --batch=all`.
4. Review a manual upload's verified proposal and browser-test the game before adding it to the site manifest. No new catalog ID is automatically enabled.
