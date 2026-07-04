# XL Traders ERP — Build Progress

Tracking file for the 12-module build described in ONESHOT_PROMPT1.md.
Resume rule: read this file, find the first module NOT marked `[DONE]`, start there.

## Setup
- [DONE] Code.backup.gs and Index.backup.html created as rollback safety net — 2026-07-04
- [DONE] Code.gs / Index.html copied from uploaded project into repo root — 2026-07-04

## Modules

- [ ] Module 0 — Global dark re-theme
- [ ] Module 1 — Keyboard core + Confirm-on-Save + Command Palette
- [ ] Module 2 — Customer & Supplier CRM depth
- [ ] Module 3 — Opening Bills (OpeningBalances)
- [ ] Module 4 — Sales Suite (Quotation → SO → Invoice → Return)
- [ ] Module 5 — Dispatch Tracking + Cash/Credit Sale Type + Payment Risk Alert
- [ ] Module 6 — Purchase Suite (Purchase Return + supplier bill matching)
- [ ] Module 7 — Bulk Payment Entry
- [ ] Module 8 — Products, Categories, Brands, Stock Ledger
- [ ] Module 9 — Follow-up CRM
- [ ] Module 10 — Admin & Roles
- [ ] Module 11 — Reports completion, Charts, Export
- [ ] Module 12 — Final QA pass

## Notes
- Testing method: mock mode only (localStorage mockServer, IS_GAS=false), verified by opening
  Index.html directly in a browser (Playwright/Chromium) — no Google login is available in this
  environment, so live-Sheet testing is the human's job after each module (see bottom of
  ONESHOT_PROMPT1.md for the exact 3 steps).
