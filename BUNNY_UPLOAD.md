# Manual Bunny CDN game uploads

This repository contains 948 root `.html` files and one `.html-a` file. Those are **source files, not an approved upload batch**. Many refer to external hosts or dependencies that are not stored here, and this repository does not provide rights evidence for every game. The workflow inventories them but uploads only packages explicitly listed in `bunny-packages/approved.json` after a rights and dependency review. Currently only the prepared, self-contained `gn-101` package is eligible. It was derived from this repository's `101-fix.html` and retains the reviewed Gurt's Games startup report and restrictive CSP. The documented owner-authorized fork and exact source/file hashes are pinned in the package list.

## Configure GitHub Actions in **erixklol/html**

In this repository's **Settings → Secrets and variables → Actions**, configure:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `BUNNY_STORAGE_PASSWORD` | Password from your Bunny **Storage Zone → Access** page. If you added this secret to `erixklol/gurtsgames`, add it separately here; repository secrets are not shared. |
| Variable | `BUNNY_STORAGE_ZONE` | The actual Storage Zone name, which may differ from `gurtsgames` or the CDN hostname. |
| Variable | `BUNNY_STORAGE_ENDPOINT` | The HTTPS regional storage endpoint shown on that zone's Access page, for example `https://ny.storage.bunnycdn.com`. |

The uploader accepts only Bunny's documented storage endpoint hosts. It uses the storage password as an `AccessKey` request header, never in a URL, source file, artifact, or printed command. Do not use a global Bunny API key. Confirm the Storage Zone is connected to the Pull Zone serving `https://gurtsgames.b-cdn.net/`. See [Bunny's Storage HTTP documentation](https://bunny.net/docs/storage/http) for endpoint and access-key details.

After this workflow is merged into the **default branch**, open **Actions → Upload reviewed games to Bunny CDN → Run workflow**. Choose `plan` first. It is the default and makes no network upload or secret access. Download the artifact to review the inventory and selected IDs. To publish, run again with `mode=upload` and a batch of `10`, `50`, `100`, or `all`. Those choices cap the count of **eligible packages**, not the count of raw HTML files. With the current package list, every choice selects one game.

The workflow writes an artifact containing `bunny-source-inventory.json`, `bunny-upload-report.json`, and `bunny-manifest-proposal.json`. The proposal contains only games whose **public CDN HTML and every packaged asset** returned the expected bytes and MIME type. A plan or failed verification never proposes an unverified game. The workflow has read-only GitHub permission and does not edit `gurtsgames`, merge, deploy, or change its existing Pages hosts. `gn-101` is already a candidate in Gurt's Games PR #13: after upload, that site's independent server check can select it automatically. Other IDs still need a separate reviewed manifest PR.

If a run fails, read `failed` and `lastCompleted` in the report. Re-run with `resume_after` equal to `lastCompleted`; leave it blank if no game completed. A partially uploaded game is safe to retry: files already matching the reviewed hash are skipped. If the CDN serves different bytes at a destination, the uploader stops instead of overwriting them. It never sends DELETE requests. Bunny edge caches may briefly keep a 404 after upload; a later manual run can verify it without re-uploading matching files.

## Add another eligible package

1. Confirm you have hosting rights for the specific game and record the basis in `bunny-packages/approved.json`. An owner fork alone is not a blanket license for all game content. Confirm gameplay and all dependencies in a browser. Do not mark a game eligible solely because its root HTML file exists.
2. Place a reviewed `index.html` and **all** its relative JavaScript, CSS, image, audio, WASM, font, and other required files under `bunny-packages/gn-<catalog-id>/`, preserving the exact relative layout. Root-relative URLs, `<base>`, and unreviewed dynamic or external network dependencies must be resolved before packaging. No symlinks. The HTML must be at most 100 KB and the package may include at most 64 assets to match the Gurt's Games [PR #13 verification limits](https://github.com/erixklol/gurtsgames/pull/13).
3. Add the catalog ID, source filename and source SHA-256, rights review note, dependency review flag, truthful `startupReport` flag, and the SHA-256 of **every** package file to `approved.json`. The uploader recalculates and checks every hash. It rejects missing, extra, changed, oversized, or statically referenced but unlisted assets.
4. Run `node --test tests/bunny-upload.test.mjs` and `node scripts/bunny-upload.mjs --mode=plan --batch=10`. Review the plan and rights basis. Then use the manual workflow upload mode.
5. Review the verified proposal and make a separate PR to merge **new IDs** into `erixklol/gurtsgames/src/lib/gn-bunny-deployments.json`. That site still performs its own server-side HTML hash and relative-asset checks at launch. Browser-test each game in its sandbox before claiming gameplay works. A successful upload does not automatically add new IDs to the site.

This is deliberately an opt-in migration. The uploader never tries to transfer all 948 HTML files, infer rights from a filename, invent missing assets, or rewrite existing game hosts.
