# Project workflow

This repository is the user's live 생활 플랫폼 (내 생활), with ledger and fridge apps.

- The user has authorized Git deployment after requested code or asset changes. Complete implementation, validation, commit, push, and deployed-site checks in the same task. Do not stop at local edits or ask again for routine deployment approval. Tool sandbox approvals still apply.
- Existing remote: `https://github.com/Mano-lee/gagyebu.git`, branch `main`. Existing public URL: `https://mano-lee.github.io/gagyebu/`. Retain this hosting route; do not create another hosted site.
- Before changes, inspect working-tree changes and remote history. Preserve unrelated user work. Never force-push, discard changes, or commit personal backups, credentials, browser profiles, or `.qa-preview/`.
- Before deployment, run `node --test tests/fridge.test.cjs`, `node tests/browser-check.cjs`, and `git diff --check`. If the icon source changes, render its PNG variants with `node tests/browser-check.cjs --render-icons` first.
- Stage intended files explicitly, commit with a clear message, and push `main` after checking remote updates. If remote changes arrive, integrate them safely and repeat affected checks.
- Inspect GitHub Pages configuration and recent deployment history with `node tests/deployment-check.cjs --inspect`. After pushing, use `node tests/deployment-check.cjs --wait` to confirm the deployed commit and published asset contents, then `node tests/browser-check.cjs --live` for a production browser smoke test. Report the commit, site URL, and any verification limit.
- All browser checks use a fresh temporary profile and synthetic data. Never write test purchases into a connected real account or Google Sheet.
- GitHub Pages deployment does not redeploy Google Apps Script. Keep `구글시트-동기화-코드.gs` free of actual secrets and clearly report when server changes require a separate Apps Script deployment.
- Extend the platform app registry and preserve app-specific navigation, existing local-storage keys, imported ledger data, shared backup, offline behavior, and transaction-to-food links.
