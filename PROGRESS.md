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
- [DONE] Module 3 — Opening Bills (OpeningBalances) — 2026-07-04
- [DONE] Module 4 — Sales Suite (Quotation → SO → Invoice → Return) — 2026-07-04
- [DONE] Module 5 — Dispatch Tracking + Cash/Credit Sale Type + Payment Risk Alert — 2026-07-04
- [DONE] Module 6 — Purchase Suite (Purchase Return + supplier bill matching) — 2026-07-04
- [DONE] Module 7 — Bulk Payment Entry — 2026-07-04
- [DONE] Module 8 — Products, Categories, Brands, Stock Ledger — 2026-07-04
- [DONE] Module 9 — Follow-up CRM — 2026-07-04
- [DONE] Module 10 — Admin & Roles — 2026-07-04
- [DONE] Module 11 — Reports completion, Charts, Export — 2026-07-04
- [DONE] Module 12 — Final QA pass — 2026-07-04

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

## Module 3 detail
Added `OpeningBalances` sheet + `apiSaveOpeningBalance`/`apiDeleteOpeningBalance` (simple upsert,
no stock/counter/P&L side effects, per spec). Each row stores its own `paidAmount` — money
collected *before* this system existed, so there's no real Payments row for it; anything
collected *after* seeding goes through the normal Payments sheet against `refId` = the opening
balance's id, which the existing `paidByRef` map already sums generically regardless of refType.
Updated all three read-sites the spec calls out as the most likely place to introduce a bug:
- `derived.partyBalance` (App.js) — added `obByParty`, net of each row's own paidAmount and any
  linked Payments, sign-flipped for Purchase-type rows.
- `buildLedgerEntries()` — one shared function (from the Module 2 refactor) already covers both
  the Reports → Party Ledger tab and the Party Detail → Ledger tab, so this fix landed in both
  places at once. Each opening balance appears as a single net dr/cr row dated at the bill's own
  date; a later real payment against it shows as its own separate ledger line, same as any invoice.
- `OutstandingReport` — Sale-type opening balances are merged into the same aging list as real
  invoices (labeled "`<billNo>` (Opening)"), not a separate report the owner has to remember to
  check.
Built `OpeningBillsPage` (nav: SETUP → Opening Bills): a single fast form (party autocomplete
with quick-add, Sale/Purchase, bill no, date, total, already-paid, notes) — no per-row grid, since
these are one-off entries, not repeating line items — followed by a party-grouped list showing
each old bill's remaining due.
Verified end-to-end in a real browser: seeded one Sale-type opening bill (₹5,000 total, ₹2,000
already paid) and confirmed the ₹3,000 due appears correctly and consistently on the Dashboard's
"To Receive" card, the Outstanding aging report, and the party's Ledger tab.

## Module 4 detail
Added `Quotations`/`QuotationItems`, `SalesOrders`/`SalesOrderItems`, `SalesReturns`/`SalesReturnItems`
sheets, plus `sourceType`/`sourceId` on `Invoices` and `SalesOrders` (Quotations never gets one —
nothing converts into a quotation, it's the top of the funnel). Neither Quotations nor SalesOrders
touch stock; that still only happens once at Invoice save, exactly as before — verified in the
browser (stock stayed 0 through Quotation and Sales Order creation, then went to −10 only after
the Invoice save).
Built one shared `SalesDocForm` component for both New Quotation and New Sales Order (they're
structurally identical — party, dated grid, discount/tax, total, no payment section) instead of
two near-duplicate forms; `useGridNav` and `AutoComplete` are reused unchanged from Module 1.
One-click conversion (`convertFrom` prop, carried through `go()`) pre-fills the next document's
party/lines from the source and marks the source `'Converted'` via a new `apiMarkConverted`
call — the source document is never deleted, per spec. Verified the full chain in a browser:
Quotation → Sales Order → Invoice, with both predecessors correctly flipping to "Converted" and
their convert-actions disappearing once used.
Sales Return (`NewSalesReturn`, reached only from an invoice's "Sales Return" button, never as a
standalone "new" flow, since a return always needs a source invoice): partial-line returns, each
capped at (invoiced qty − already returned qty) using a new `returnedQtyByInvoiceItem` derived
map. Stock comes back in immediately. The receivable reduction reuses the *existing* Payments
mechanism instead of inventing a parallel one — a return writes a Payments row (`refType:
'SalesReturn'`, `refId`: the original invoice's id) so Outstanding/party-balance/ledger keep
working with zero further changes. That payment's own `id` is deliberately set equal to the
return's id (documented in the Code.gs comment) so deleting a return can find and remove exactly
that credit in O(1) instead of guessing among possibly-several returns against the same invoice.
Verified in a browser: returning 4 of 10 units dropped stock from −10 to −6 and the party's due
from ₹1,000 to ₹600 in one step.
Added WhatsApp share (`invoiceWhatsAppLink` — India-first phone normalization, falls back to a
bare wa.me contact-picker link when the party has no phone on file) and PDF download
(`apiHtmlToPdf` — Apps Script's built-in `Utilities.newBlob(html).getAs('application/pdf')`, no
external library) to the Invoice view. PDF conversion can't be exercised here (no real GAS
runtime in this environment) — the mock server returns `base64: null` and the client falls back
to the existing print dialog, which the human should verify for real after deploying.

## Module 5 detail
Added `billType`, `dispatchStatus`, `dispatchedAt` to `Invoices` and a `DispatchLog` sheet
(audit trail only — never adjusts stock; stock still only moves once, at Invoice save,
exactly as every earlier module). `dispatchStatus` defaults to `'Pending'` enforced
**server-side** in `apiSaveInvoice` (not just left to the client) — a brand new invoice
always starts undispatched no matter what the client sends, since printing a bill isn't
the same as the goods leaving. `apiMarkDispatch` flips the flag both ways (Dispatched ⇄
Pending/Reverted) and appends exactly one `DispatchLog` row per action.
New Sale gained a Cash/Credit segmented toggle next to the Payment card header (`billType`,
independent of `payMode` — the existing "how was it actually paid" field). Sales List gained
a dispatch-status badge + "Mark Dispatched" (small modal: optional vehicle no/transporter/
notes) / "Revert" per row, and a "Pending Dispatch" filter pill alongside the existing ones.
Dashboard gained two conditional cards: "Goods Pending Dispatch" (count + quick list, links
to Sales List pre-filtered) and "Cash Sales — Payment Not Received" (red, intentionally
narrower than the Outstanding report — only Cash-terms invoices that have already shipped
but aren't paid, since that's a harder-to-collect anomaly a normal credit sale isn't).
Verified every line of the module's own acceptance checklist in a real browser: created a
Cash-terms invoice through the actual UI and confirmed it started `Pending`; marked it
Dispatched and confirmed exactly one DispatchLog row was written and the "Pending Dispatch"
filter correctly dropped it to zero matches; then seeded the three boundary-case invoices
(Cash+Unpaid+Dispatched, Credit+Unpaid+Dispatched, Cash+Paid+Dispatched) and confirmed the
risk card showed exactly the first case and correctly excluded the other two.

## Module 6 detail
Added `PurchaseReturns`/`PurchaseReturnItems` sheets and a `supplierInvoiceNo` column on
`Purchases`, plus a `prPrefix` ('PR-') setting. `apiSavePurchaseReturn`/`apiDeletePurchaseReturn`
mirror `apiSaveSalesReturn`/`apiDeleteSalesReturn` exactly but reversed: each returned line
subtracts from stock (goods physically leaving our warehouse back to the supplier) instead of
adding, and the refund is recorded as a synthetic Payments row with `direction: 'Out'` (money we
conceptually recover from the supplier reduces what we owe them) instead of `'In'`. Same id-sharing
trick as Sales Return: the Payments row's own `id` equals the return's id, so `paidByRef`
aggregation and later deletion both work for free without new lookup logic.
`NewPurchase` gained a `supplierInvoiceNo` field (their bill/invoice number, distinct from our own
auto-numbered `billNo`) alongside a shortened Notes field to keep the header at 4 columns.
`PurchaseList` search now also matches `supplierInvoiceNo`, and its bill-view modal shows the
supplier's invoice number plus a new "↩️ Purchase Return" button (same placement/pattern as
Invoice view's "↩️ Sales Return"). `NewPurchaseReturn` and `PurchaseReturnsList` are direct
structural mirrors of `NewSalesReturn`/`SalesReturnsList` — partial-line returns capped at
(purchased qty − already returned qty) via `derived.returnedQtyByPurchaseItem`, same non-tax-
prorated straight refund total.
Verified live in a headless Chromium browser against the mock server: created a purchase with a
supplier invoice number, confirmed it's searchable/visible in Purchase List and its view modal;
opened Purchase Return from that modal and returned 6 of 20 units; confirmed stock went 20→14
(OUT, reversed direction from Sales Return's IN), the supplier's payable balance dropped by exactly
the ₹480 refund amount, and reopening the return form afterward correctly showed 6 already
returned / 14 still returnable (the cap holds across repeat visits, not just within one session).

## Module 7 detail
Added `apiSaveBulkPayment` (Code.gs): one atomic `withLock_` call that writes several
`Payments` rows at once — one per document allocation, plus one more for any leftover kept
"on account" (no `refId`). Deliberately reuses the existing flat `Payments` schema rather than
adding a new "batch" concept, so every existing calculation that sums by `refId` (`paidByRef`,
ledgers, Outstanding report) needed zero new code to understand bulk-entered payments.
New `BulkPaymentPage` (Index.html): pick a direction (Receive from customer / Pay out to
supplier), pick the party, and its open invoices/bills (same `due = total − paidByRef` calc as
the existing single-payment `PaymentModal`) list out oldest-first. Entering a total amount
auto-allocates oldest-first up to each document's due automatically; any per-line amount can
still be hand-edited afterward (capped at that line's own due), and anything left over once
every open document is covered is shown live as "On account" and saved as its own Payments row
rather than silently discarded. Reachable from a new "Bulk Payment" nav item (MAIN section) and
a matching button on the Payments page header.
Verified live in a headless Chromium browser: seeded a customer with two open invoices
(₹300 and ₹700, oldest first), entered a single total of ₹1,200 on the Bulk Payment page,
confirmed auto-allocation split it 300/700 with ₹200 correctly left "on account", saved, and
confirmed three separate Payments rows were written (300 against BP-OLD, 700 against BP-NEW,
200 on account) — then confirmed the Outstanding report shows "Nothing outstanding — all
invoices paid!", proving the allocation actually clears the receivable through the normal
paidByRef path with no special-casing needed.

## Module 8 detail
`category`/`brand` were already plain fields on `Items` (no dedicated sheets existed or were
needed — a small trading business has maybe a dozen categories/brands total, so a free-text field
plus filters built from the item list's own distinct values is simpler than a separate CRUD entity
with its own add/edit/delete screens, and it can never drift out of sync with what items actually
use). `ItemsPage` gained two dropdown filters — Category and Brand — built from
`[...new Set(db.items.map(...))]` over whatever values are already in use, combinable with each
other, the free-text search, and the existing "Low stock only" checkbox.
The bigger piece: a real **Stock Ledger**, which didn't exist before (the old "Stock" report tab
was just a current-snapshot valuation, no movement history). `buildStockLedgerEntries(item, db,
derived)` mirrors the existing `buildLedgerEntries` party-ledger pattern: it collects every
Purchase (IN), Invoice (OUT), Sales Return (IN), and Purchase Return (OUT) line for one item,
sorts oldest-first, and computes a running balance. Since `item.stock` is always the live total
(mutated directly by `adjustStock_`/`stockAdj` on every save) rather than a derived value, there's
no stored "opening stock" transaction to read — so opening is reverse-derived as
`current stock − sum(all movement deltas)`, which also self-checks: the ledger's last running
balance always equals `item.stock` exactly, or a bug would be immediately visible.
`ItemLedgerModal` (wide modal, same visual language as `SalesReturnsList`'s view modal) is wired
from two places: a new "📒" button per row on `ItemsPage`, and clicking any row in the Reports →
Stock tab (which now also receives `derived`) — same dual-access pattern Party Ledger already has
(Parties list "Ledger" button + Reports → Party Ledger tab).
Verified live in a headless Chromium browser: seeded one item through a full
Purchase(+50)→Sale(−20)→Sales Return(+5)→Purchase Return(−3) history (net stock 32, matching the
seeded `item.stock`), confirmed the category and brand dropdown filters each correctly isolated
the right item, and confirmed the ledger modal — opened both from Items & Stock and from
Reports → Stock — showed all four movements in date order with a running balance ending exactly
at 50 → 30 → 35 → 32, matching current stock with no discrepancy.

## Notes
- Testing method: mock mode only (localStorage mockServer, IS_GAS=false), verified by opening
  Index.html directly in a browser (Playwright/Chromium) — no Google login is available in this
  environment, so live-Sheet testing is the human's job after each module (see bottom of
  ONESHOT_PROMPT1.md for the exact 3 steps).
- Known pre-existing minor UX nit (not introduced by Module 6, not fixed here): `PartyDetail`'s
  balance subtitle labels any negative balance "Advance" regardless of party type. For a Supplier,
  a negative balance means we owe them (payable), not that they've paid in advance — the label
  should probably read "Payable" for suppliers and "Advance" only for customers. Flagged for a
  later polish pass rather than fixed now since it touches balance-label wording used everywhere,
  not just the Purchase Suite.

## Module 9 detail
Added a `Followups` sheet (`id, partyId, partyName, dueDate, note, status, createdAt,
completedAt`) — a new sheet rather than overloading the existing free-text `Parties.notes` field,
so overdue/due-today items can actually be queried and surfaced as a worklist instead of living in
unstructured text nobody re-reads. `apiSaveFollowup`/`apiDeleteFollowup` are as simple as
`apiSaveOpeningBalance` — plain `upsert_`/`deleteById_`, no stock or money side effects.
`PartyDetail` gained a "Follow-ups" tab (between Ledger and Documents), showing an open-count
badge in the tab label itself, with a small add-form (due date + note) and a list with Mark
Done/Reopen/Delete per row — this replaces the stale "this becomes a follow-up timeline in a
later module" comment that was sitting in `PartyNotesTab` since Module 2, now that it's true.
A new global `FollowupsPage` (NAV: MAIN section, after Bulk Payment) lists every open follow-up
across every party, soonest-due first, with a "Show completed" toggle and a direct link back to
the originating party — the cross-party worklist a follow-up system is actually for, versus the
per-party tab which is for adding/reviewing one party's own history. Dashboard gained a
"Follow-ups Due" card (same visual language as the Module 5 dispatch/risk cards) listing anything
open with `dueDate <= today`, tagged "Overdue" or "Today".
Verified live in a headless Chromium browser: created a party, added one overdue (01/06) and one
due-today (04/07) follow-up via its Follow-ups tab, confirmed both appeared on the Dashboard card
and the global worklist with correct Overdue/Today/Open tags and counts; marked the overdue one
Done and confirmed it dropped out of both the default worklist view and the Dashboard count
(2 → 1), then confirmed "Show completed" brought it back with a strikethrough note and a DONE
badge.

## Module 9 notes
- Testing method: mock mode only (localStorage mockServer, IS_GAS=false), verified by opening
  Index.html directly in a browser (Playwright/Chromium) — no Google login is available in this
  environment, so live-Sheet testing is the human's job after each module (see bottom of
  ONESHOT_PROMPT1.md for the exact 3 steps).
- Known pre-existing minor UX nit (not introduced by Module 6): `PartyDetail`'s balance subtitle
  labeled any negative balance "Advance" regardless of party type. For a Supplier, a negative
  balance means we owe them (payable), not that they've paid in advance. **Fixed in Module 12** —
  now reads "Payable" for a Supplier and "Advance" only for a Customer.

## Module 10 detail
**Scope decision made explicit (read this before touching roles again):** this app has no separate
login system, and deliberately doesn't get one. It's a Google Sheet-bound Apps Script web app —
real access control is Google Sheet sharing, which exists entirely outside this codebase. Anyone
with edit access to the Sheet can already open the Apps Script editor and read/change anything
here, same as any other bound script. So "Admin & Roles" is a **workflow permission layer**, not a
security boundary: it decides what someone sees in the UI once they're already in, using the real
identity Apps Script gives for free (`Session.getActiveUser().getEmail()`) — no passwords, no
separate user table to keep in sync with Sheet sharing. This is stated in a comment at the top of
both the `Users` schema block (Code.gs) and `AdminPage` (Index.html) so it isn't misread later as
"real" auth.
Added a `Users` sheet (`id, email, name, role, active`; role is just `'Owner'` or `'Staff'` — two
roles is enough for a small trading business, not a permissions matrix). `bootstrap()` now
auto-grants the very first person who ever opens the app as Owner (otherwise nobody could reach
Admin to grant the first role), computes `currentUser` from their real email, and defaults any
email not found in `Users` to `'Staff'` (least privilege for unrecognized accounts, not an outright
block — they already have Sheet access, silently locking them out of the UI would just confuse,
not protect, anyone). `apiSaveUser`/`apiDeleteUser` are Owner-only, enforced **server-side** via a
new `requireOwner_()` check — the client-side nav/route gating below is not the only thing
stopping a Staff account from editing roles. Both also refuse to demote/deactivate/delete the last
remaining active Owner, so nobody can lock everyone out of Admin by mistake.
Frontend: NAV items for `settings` and the new `admin` page carry an `ownerOnly` flag, filtered out
of the sidebar, the command palette's results, for Staff accounts (defense in depth: both
`SettingsPage` and the new `AdminPage` also self-check `isOwner` and render an "Access restricted"
message if somehow reached anyway). A small sidebar footer now shows the signed-in email and a
role badge, so it's always visible who you are and what you can do. `AdminPage` itself: add a user
by email (defaults to Staff), change role via a dropdown, deactivate/reactivate, delete — with the
last-Owner controls visibly disabled (not just server-rejected) so the guard rarely has to fire in
practice.
**Explicitly out of scope for this module** (a deliberate cut, not an oversight): gating individual
delete buttons across every list page (Items, Parties, Purchases, etc.) to Owner-only. That's 15+
call sites: a real feature, but disproportionate to add and verify correctly in this pass. Settings
+ the Admin screen itself were judged the two highest-value gates (where business config and role
assignment itself live); broader "hide delete everywhere" is a natural, cleanly-scoped follow-up.
Verified live in a headless Chromium browser: first load auto-became Owner (sidebar footer +
Admin/Settings both visible); added a Staff user from Admin, confirmed the sole Owner's own
role-dropdown and Deactivate/Delete controls were disabled (last-Owner guard); promoted the new
user to Owner and confirmed both rows' controls unlocked with two Owners present; then simulated a
Staff-only session (reseeded the mock identity as the Staff account) and confirmed Admin & Roles
and Settings both disappeared from the sidebar, and the command palette returned "No matches" for
a "Settings" search — the gating holds across all three surfaces (nav, direct route, palette).

## Module 11 detail
Added a dependency-free `BarChart` component — plain flex divs sized by percentage-of-max width,
not SVG/canvas or a charting library. Production already depends on one CDN fetch that can fail
(Tailwind, see `__cdnFail`); a charting library would be a second external dependency for what a
dozen styled divs render identically, with zero new failure modes. Wired into: P&L (top 8 items by
profit), Sales (sales by month), and Outstanding (due by aging bucket) — the three report tabs
where a trend/comparison is more legible as a chart than another table.
Added a shared `downloadCsv(filename, rows, cols)` helper (extracted from the existing whole-
database `exportCSV`) and gave every report tab its own contextual "⬇ Export CSV" button —
P&L (item-wise profit), Sales (monthly), Purchase (by supplier), Stock (by item), Outstanding
(aging detail) — exporting exactly what's on screen for that tab/date range, distinct from the
existing Settings page button that dumps the entire database at once.
That whole-database export (`exportCSV`) was also **completed** — it previously only covered 5
entities (Items/Parties/Invoices/Purchases/Payments) from early modules and had silently gone
stale as Quotations, Sales Orders, Sales/Purchase Returns, Opening Balances, and Follow-ups were
added in later modules. Now includes all of them.
Verified live in a headless Chromium browser: seeded two months of invoices (two items, mixed
paid/unpaid) and one purchase, widened the report date range, and confirmed the P&L item-profit
chart and Sales monthly chart both render bars proportional to the correct underlying numbers;
triggered CSV downloads from P&L and Sales tabs and confirmed the browser's download event fired
with the expected filename; confirmed the Outstanding aging-bucket chart's ₹750 in the 31–60 day
bucket matches the sum of the two unpaid invoices shown in the table beneath it; and confirmed the
whole-database export from Settings now includes all eleven exported sections (previously
five), not just the ones that existed when that button was first built.

## Module 12 detail — Final QA pass
Ran a set of whole-app consistency checks that only make sense once every module exists together,
rather than re-verifying each module in isolation again:
- **No debug leftovers:** grepped both files for `console.log`, `TODO`, `FIXME`, `debugger` — none
  found.
- **Syntax:** `node --check` on the full extracted app script and on `Code.gs` — both clean.
- **Backend/mock parity:** every `apiXxx` function in `Code.gs` (32 total) has exactly one matching
  `case "apiXxx"` in the mock server, and vice versa — no orphaned real endpoint the local preview
  can't simulate, no mock case for an endpoint that doesn't exist server-side.
- **Settings parity:** `DEFAULT_SETTINGS` (Code.gs) and `MOCK_DEFAULT_SETTINGS` (Index.html) have
  the exact same key set — no setting silently missing its mock default.
- **Action wiring:** every `actions.X(...)` call site in the frontend resolves to a defined action
  — no dead references to a renamed/removed action.
- **Sheet auto-provisioning:** confirmed `ensureDatabase_()` is fully generic (iterates
  `Object.keys(SCHEMA)`), so all 20 sheets — including every one added in Modules 3–10 — get
  created with correct headers automatically; nothing needed manual wiring that could've been
  missed.
- **Full click-through:** visited all 18 pages reachable from the sidebar (Dashboard through
  Settings/Admin) in a fresh headless Chromium session with zero seed data, confirmed every one
  renders with no console/page errors and a sensible empty state — this is the first time in the
  whole build that literally every page was visited back-to-back in one session, which is exactly
  where an interaction between two modules built on different days would show up if there were one.
- **Fixed the one item on the "known nits" list from Module 6:** `PartyDetail`'s balance subtitle
  now reads "Payable" for a Supplier with a negative balance instead of "Advance" (which only
  makes sense for a Customer who's pre-paid) — one-line fix (`party.type === 'Supplier' ? 'Payable'
  : 'Advance'`), verified both ways in a browser: a Supplier and a Customer each seeded with the
  same negative opening balance now show the correct word for their side of the relationship.

## 🎉 BUILD COMPLETE — all 12 modules done, verified, committed
Every module in ONESHOT_PROMPT1.md's spec has been built, tested in a real headless-Chromium
browser against the mock server (not just read for correctness), and pushed to
`claude/suggestions-improvements-2x8cz8`. The suggestions-for-further-improvement the user asked
for at the very start of this session are the next and final deliverable — see the chat response
for that session, not this file (this file tracks build progress, not the standing suggestions
list, so it isn't duplicated here).
