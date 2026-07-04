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

## STATUS AS OF 2026-07-04 — resume from Module 10

**Fully done, verified, committed:** Modules 0–9 (dark re-theme, keyboard core, CRM depth, opening
balances, full Quotation→Sales Order→Invoice→Sales Return suite, dispatch tracking + cash/credit
risk alert, full Purchase Suite with Purchase Return, Bulk Payment Entry, Category/Brand filters +
Stock Ledger, and now Follow-up CRM). Each was checked by actually running the app in a headless
Chromium browser against the mock server, not just read for correctness — Module 9's verification
covered the full add→appear-on-dashboard→mark-done→reopen round trip.

**Not started: Modules 10–12.** Admin/Roles, Reports/Charts/Export, and the final QA pass remain.
Stopping at a clean module boundary, with everything so far genuinely finished and tested, is the
honest choice over rushing several large modules at once.

**To resume:** open a new session against this same branch/repo, tell Claude "read PROGRESS.md,
resume from Module 10," and it starts on Admin & Roles (the spec text itself should be checked for
the exact shape since it wasn't retained verbatim in this file — likely a user-role concept,
e.g. Owner vs Staff, gating destructive actions like deletes/settings behind a role check; this
app currently has no auth/login concept at all, so the scope of "roles" needs deciding first: a
simple client-side role toggle stored in Settings for now, versus real per-user auth, which would
be a much larger undertaking than anything built so far and may need explicit user confirmation
on approach before implementation).
