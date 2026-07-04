# XL Traders ERP — Build Progress

Tracking file for the 12-module build described in ONESHOT_PROMPT1.md.
Resume rule: read this file, find the first module NOT marked `[DONE]`, start there.

## Setup
- [DONE] Code.backup.gs and Index.backup.html created as rollback safety net — 2026-07-04
- [DONE] Code.gs / Index.html copied from uploaded project into repo root — 2026-07-04

## Modules

- [DONE] Module 0 — Global dark re-theme — 2026-07-04
- [DONE] Module 1 — Keyboard core + Confirm-on-Save + Command Palette — 2026-07-04
- [DONE] Module 2 — Customer & Supplier CRM depth — 2026-07-04
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

## Module 0 detail
Converted every screen (sidebar, mobile nav, Dashboard, New Sale, New Purchase, Sales/Purchase
List, Items, Parties, Payments, Reports incl. all sub-reports, Settings, modals, toasts,
autocomplete dropdown, badges) from the old light `ink`/`brand` custom Tailwind colors to the
real `zinc`/`red` palette specified in the brief. Removed the custom `ink`/`brand` color
definitions from `tailwind.config` entirely — using Tailwind's real built-in scales is more
maintainable than keeping a same-named-but-repointed indirection.
Found and fixed one real bug during verification: two raw `<input>` elements (Discount in New
Sale, Other charges in New Purchase) didn't use the shared `inputCls` and so kept the browser's
white default background even after the retheme — added explicit dark classes to both, plus a
defensive global CSS rule (`input,select,textarea{background-color:...}`) so this class of bug
can't silently recur on any future raw input.
Verified visually in a real Chromium browser (Playwright) against the mock-mode app: Dashboard
incl. low-stock alert, New Sale incl. keyboard-focus ring on a billing-grid cell, Item/Party/
Payment modals, Purchase, Reports incl. Outstanding tab, Settings. Print view intentionally left
light/white (untouched) since it's meant to be printed on paper.

## Module 1 detail
Added `useGridNav(flow)` — one shared hook (Tab native, Enter → next field / commit+new-row,
Arrow Up/Down → same field prev/next row) — and refactored New Sale and New Purchase to use it
instead of each keeping its own copy-pasted focus/keydown logic. Taught `AutoComplete` an
optional `onArrow` prop so item-name cells can hand Up/Down back to the grid once there's no
live query to browse (a query with real matches still lets arrows browse the suggestion
dropdown) — pickers that don't pass `onArrow` (Party Ledger search, Payment modal) keep their
original arrow-browses-suggestions behavior untouched, zero regression risk there.
Added `SaveConfirmModal` ("Invoice INV-4 saved ✓ — ₹1,240" / Save & New (Enter, default) / Done)
and wired it into both New Sale and New Purchase for new (non-edit) documents — editing an
existing document still saves straight back to its list, since "Save & New" doesn't make sense
mid-edit. Added `CommandPalette` (Ctrl/Cmd+K — searches pages, parties, items, recent invoices,
arrow+Enter to navigate) and `ShortcutSheet` ("?" — lists every shortcut), both wired at the App
shell level. Ctrl/Cmd+N jumps to New Sale from anywhere (the most common "new entry" action).
Verified in a real browser: grid Enter-flow, Arrow-Down jumping to the same column on the next
row, Save & New resetting the form and refocusing row 1, the command palette's live search, and
the shortcut sheet — for both New Sale and New Purchase.

## Module 2 detail
Added `PartyContacts` sheet + CRUD (`apiSaveContact`/`apiDeleteContact`, cascade-deleted when the
party is deleted), `category` + `visitingCardUrl` columns on `Parties`, and `apiUploadVisitingCard`
(Drive upload — deliberately does NOT call `setSharing`, since a visiting card carries someone's
personal name/phone; it stays private to the same Google account as the spreadsheet, not a public
"anyone with the link" URL).
Party rows now navigate to a full `PartyDetail` page (Profile / Ledger / Documents / Notes tabs)
instead of opening the old edit modal — `PartyModal` is now only the quick "+ Add Party" flow,
same pattern as quick-create in the billing grids. Extracted `buildLedgerEntries()` out of
`LedgerReport` so the Reports tab and the new Party Detail → Ledger tab share one calculation
instead of two copies that could drift. Added `waLink()`/`telLink()` helpers (India-first: bare
10-digit numbers get a `91` prefix for wa.me) and wired WhatsApp/Call buttons onto each contact.
Notes tab is a plain textarea against `party.notes` for now — it explicitly becomes the FollowUps
timeline once Module 9 is built, not duplicated logic now that gets thrown away later.
Verified in a real browser: create party → add contact → WhatsApp/Call icons render → Ledger tab
(empty state) → Documents tab (upload UI) → Notes save → Category field round-trips after tab
switch.

## Notes
- Testing method: mock mode only (localStorage mockServer, IS_GAS=false), verified by opening
  Index.html directly in a browser (Playwright/Chromium) — no Google login is available in this
  environment, so live-Sheet testing is the human's job after each module (see bottom of
  ONESHOT_PROMPT1.md for the exact 3 steps).

## STATUS AS OF 2026-07-04 — resume from Module 3

**Fully done, verified, committed:** Modules 0, 1, 2 (dark re-theme, keyboard core, CRM depth).
Each was checked by actually running the app in a headless Chromium browser against the mock
server, not just read for correctness — screenshots confirmed dark theme consistency, keyboard
grid navigation, the save-confirm flow, the command palette, and the new Party Detail page all
work as specified.

**Not started: Modules 3–12.** This is the honest state — the remaining modules (Opening
Balances, the full Quotation→SO→Invoice→Return suite, Dispatch tracking, Purchase Returns, Bulk
Payment Entry, Categories/Brands/Stock Ledger, Follow-up CRM, Admin/Roles, Reports/Charts, and
the final QA pass) are comparable in size to Modules 0–2 combined, several times over — Module 4
alone (four new document types with a conversion pipeline between them) is bigger than everything
done so far. Building all of them to the same standard (real schema changes, real mock-server
parity, real browser verification, no placeholders) in one sitting was not realistic without
either rushing the quality bar or silently stopping partway through a module. Stopping at a clean
module boundary, with everything so far genuinely finished and tested, was the more honest choice.

**To resume:** open a new session against this same branch/repo, tell Claude "read PROGRESS.md,
resume from Module 3," and it starts on Opening Balances (schema + entry screen + updating
partyBalance/LedgerReport/OutstandingReport to include it — the note in ONESHOT_PROMPT1.md flags
"forgetting one of those three read-sites" as the most likely bug, worth double-checking).
