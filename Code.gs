/**
 * XL TRADERS ERP — Google Apps Script Backend
 * ---------------------------------------------------------------
 * Database  : Google Sheets (this bound spreadsheet)
 * Frontend  : Index.html (React SPA, served by doGet)
 *
 * DESIGN PRINCIPLES
 * 1. One bootstrap() call loads ALL data → client works offline-fast.
 * 2. Every write is batched (setValues / appendRow) — never cell-by-cell.
 * 3. LockService guards invoice numbering + stock updates (multi-device safe).
 * 4. Payments sheet is the single source of truth for paid amounts.
 * 5. Dates are stored and returned as 'YYYY-MM-DD' strings (no timezone bugs).
 */

// ================= SHEET SCHEMA =================
var SCHEMA = {
  Items: ['id','name','brand','category','unit','packSize','saleRate','purchaseRate','stock','minStock','active'],
  Parties: ['id','name','type','phone','address','gstin','openingBalance','notes','category','visitingCardUrl'],
  PartyContacts: ['id','partyId','name','role','phone','whatsapp'],
  Invoices: ['id','invNo','date','partyId','partyName','subTotal','discount','taxPct','taxAmt','total','payMode','status','notes','createdAt','sourceType','sourceId','billType','dispatchStatus','dispatchedAt'],
  InvoiceItems: ['id','invoiceId','itemId','name','brand','packing','packs','qty','rate','amount','cost'],
  Purchases: ['id','billNo','date','partyId','partyName','subTotal','other','total','payMode','notes','createdAt','supplierInvoiceNo'],
  PurchaseItems: ['id','purchaseId','itemId','name','qty','rate','amount'],
  Payments: ['id','date','partyId','partyName','refType','refId','amount','mode','direction','notes'],
  OpeningBalances: ['id','type','partyId','partyName','billNo','date','amount','paidAmount','notes','createdAt'],
  // ---- Sales Suite (Module 4): Quotation -> Sales Order -> Invoice -> Sales Return ----
  // Quotations/SalesOrders mirror the Invoices shape (no payMode — nothing's being paid
  // yet) plus sourceType/sourceId so a document can record which earlier document it was
  // converted from, without ever deleting that earlier document (it's marked 'Converted').
  Quotations: ['id','quoNo','date','partyId','partyName','subTotal','discount','taxPct','taxAmt','total','status','notes','createdAt'],
  QuotationItems: ['id','quotationId','itemId','name','brand','packing','packs','qty','rate','amount','cost'],
  SalesOrders: ['id','soNo','date','partyId','partyName','subTotal','discount','taxPct','taxAmt','total','status','notes','createdAt','sourceType','sourceId'],
  SalesOrderItems: ['id','salesOrderId','itemId','name','brand','packing','packs','qty','rate','amount','cost'],
  SalesReturns: ['id','srNo','date','partyId','partyName','subTotal','taxAmt','total','status','notes','createdAt','sourceType','sourceId'],
  SalesReturnItems: ['id','salesReturnId','invoiceItemId','itemId','name','brand','packing','qty','rate','amount'],
  // ---- Dispatch tracking (Module 5) — audit trail only, NEVER moves stock. Stock is
  // deducted exactly once, at Invoice save; marking something Dispatched just flips a
  // status flag and logs who/when, because printing a bill isn't the same as it leaving.
  DispatchLog: ['id','invoiceId','invNo','partyName','action','vehicleNo','transporter','notes','timestamp','userEmail'],
  // ---- Purchase Suite (Module 6): Purchase Return — the exact mirror of Sales Return
  // (Module 4), reversed: stock goes OUT (goods going back to the supplier) and the
  // payable is reduced, using the same synthetic-Payments-row trick for the same reason
  // (Payments stays the one source of truth for "how much of this bill is settled").
  PurchaseReturns: ['id','prNo','date','partyId','partyName','subTotal','total','status','notes','createdAt','sourceType','sourceId'],
  PurchaseReturnItems: ['id','purchaseReturnId','purchaseItemId','itemId','name','qty','rate','amount'],
  Settings: ['key','value'],
  Counters: ['key','value']
};

var DEFAULT_SETTINGS = {
  bizName: 'XL TRADERS',
  bizTagline: 'Packaging · Catering · Cleaning · Decoration Supplies',
  bizAddress: '44, Jay Ambey Nagar, Near Milan Point, Bamroli Road, Pandesara, Surat',
  bizPhone: '77780 52990 / 97732 39442',
  bizEmail: 'xltraders990@gmail.com',
  bizGstin: '',
  invPrefix: 'INV-',
  purPrefix: 'PB-',
  quoPrefix: 'QUO-',
  soPrefix: 'SO-',
  srPrefix: 'SR-',
  prPrefix: 'PR-',
  taxEnabled: false,
  taxPct: 18,
  taxLabel: 'GST',
  currency: '₹',
  invoiceFooter: 'Thank you for your business! Goods once sold will not be taken back.',
  lowStockAlert: true,
  units: ['Pcs','Kg','Box','Pkt','Dozen','Roll','Bundle','Ltr'],
  payModes: ['Cash','UPI','Credit','Cheque','Bank']
};

// ================= WEB APP ENTRY =================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('XL Traders ERP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ================= LOW-LEVEL HELPERS =================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getSheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SCHEMA[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Ensure all sheets exist with correct headers. Runs once, cheap afterwards. */
function ensureDatabase_() {
  Object.keys(SCHEMA).forEach(function(name) { getSheet_(name); });
  // Seed settings if empty
  var sh = getSheet_('Settings');
  if (sh.getLastRow() < 2) {
    sh.appendRow(['app', JSON.stringify(DEFAULT_SETTINGS)]);
  }
  // Seed counters if empty
  var cs = getSheet_('Counters');
  if (cs.getLastRow() < 2) {
    cs.getRange(2, 1, 2, 2).setValues([['INV', 0], ['PUR', 0]]);
  }
}

/** Normalize a single cell value for JSON transport (Dates → 'YYYY-MM-DD'). */
function normCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

/** Read a whole sheet into an array of objects using SCHEMA headers. */
function readAll_(name) {
  var sh = getSheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SCHEMA[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    if (values[r][0] === '' || values[r][0] === null) continue; // skip blank rows
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = normCell_(values[r][c]);
    out.push(obj);
  }
  return out;
}

/** Convert object to row array in SCHEMA order. */
function toRow_(name, obj) {
  return SCHEMA[name].map(function(h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** Find the sheet row number (1-based) of a record by id. Returns -1 if absent. */
function findRow_(name, id) {
  var sh = getSheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/** Insert or update a record. Returns the saved object. */
function upsert_(name, obj) {
  var sh = getSheet_(name);
  var row = obj.id ? findRow_(name, obj.id) : -1;
  if (!obj.id) obj.id = Utilities.getUuid().slice(0, 8);
  var rowData = toRow_(name, obj);
  if (row > 0) {
    sh.getRange(row, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sh.appendRow(rowData);
  }
  return obj;
}

/** Delete a single record by id. */
function deleteById_(name, id) {
  var row = findRow_(name, id);
  if (row > 0) getSheet_(name).deleteRow(row);
}

/** Delete all child rows where column matches value (bottom-up, batched read). */
function deleteChildren_(name, column, value) {
  var sh = getSheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SCHEMA[name];
  var col = headers.indexOf(column);
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var removed = [];
  for (var r = values.length - 1; r >= 0; r--) {
    if (String(values[r][col]) === String(value)) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = normCell_(values[r][c]);
      removed.push(obj);
      sh.deleteRow(r + 2);
    }
  }
  return removed;
}

/** Atomically increment a counter and return the new value. Caller must hold lock. */
function nextCounter_(key) {
  var sh = getSheet_('Counters');
  var last = sh.getLastRow();
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === key) {
      var next = Number(values[i][1]) + 1;
      sh.getRange(i + 2, 2).setValue(next);
      return next;
    }
  }
  sh.appendRow([key, 1]);
  return 1;
}

/** Adjust stock for a map of {itemId: deltaQty}. Batched single write. */
function adjustStock_(deltas) {
  var sh = getSheet_('Items');
  var last = sh.getLastRow();
  if (last < 2) return;
  var headers = SCHEMA.Items;
  var stockCol = headers.indexOf('stock') + 1;
  var range = sh.getRange(2, 1, last - 1, headers.length);
  var values = range.getValues();
  var dirty = false;
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][0]);
    if (deltas[id]) {
      values[r][stockCol - 1] = Number(values[r][stockCol - 1] || 0) + deltas[id];
      dirty = true;
    }
  }
  if (dirty) range.setValues(values);
}

/** Update purchase cost of items after a purchase (last-rate strategy). */
function updateItemCosts_(costMap) {
  var sh = getSheet_('Items');
  var last = sh.getLastRow();
  if (last < 2) return;
  var headers = SCHEMA.Items;
  var costCol = headers.indexOf('purchaseRate');
  var range = sh.getRange(2, 1, last - 1, headers.length);
  var values = range.getValues();
  var dirty = false;
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][0]);
    if (costMap[id] !== undefined && costMap[id] > 0) {
      values[r][costCol] = costMap[id];
      dirty = true;
    }
  }
  if (dirty) range.setValues(values);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ================= PUBLIC API (called via google.script.run) =================

/** ONE call that loads the entire database for the client. */
function bootstrap() {
  ensureDatabase_();
  var settingsRows = readAll_('Settings');
  var settings = DEFAULT_SETTINGS;
  for (var i = 0; i < settingsRows.length; i++) {
    if (settingsRows[i].key === 'app') {
      try {
        var saved = JSON.parse(settingsRows[i].value);
        settings = Object.assign({}, DEFAULT_SETTINGS, saved);
      } catch (e) { /* keep defaults on parse failure */ }
    }
  }
  return JSON.stringify({
    settings: settings,
    items: readAll_('Items'),
    parties: readAll_('Parties'),
    partyContacts: readAll_('PartyContacts'),
    invoices: readAll_('Invoices'),
    invoiceItems: readAll_('InvoiceItems'),
    purchases: readAll_('Purchases'),
    purchaseItems: readAll_('PurchaseItems'),
    payments: readAll_('Payments'),
    openingBalances: readAll_('OpeningBalances'),
    quotations: readAll_('Quotations'),
    quotationItems: readAll_('QuotationItems'),
    salesOrders: readAll_('SalesOrders'),
    salesOrderItems: readAll_('SalesOrderItems'),
    salesReturns: readAll_('SalesReturns'),
    salesReturnItems: readAll_('SalesReturnItems'),
    dispatchLog: readAll_('DispatchLog'),
    purchaseReturns: readAll_('PurchaseReturns'),
    purchaseReturnItems: readAll_('PurchaseReturnItems')
  });
}

/**
 * Save (create or edit) a sale invoice transactionally.
 * payload = { invoice, items:[...], payment: {amount, mode} | null }
 * On edit: old lines are removed and their stock restored first.
 */
function apiSaveInvoice(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var inv = payload.invoice;
    var lines = payload.items || [];
    var isEdit = !!inv.id && findRow_('Invoices', inv.id) > 0;

    var deltas = {};

    if (isEdit) {
      var oldLines = deleteChildren_('InvoiceItems', 'invoiceId', inv.id);
      oldLines.forEach(function(l) {
        if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) + Number(l.qty || 0); // restore
      });
    } else {
      if (!inv.invNo) {
        var settings = getSettings_();
        inv.invNo = settings.invPrefix + nextCounter_('INV');
      }
      inv.createdAt = new Date().toISOString();
      // Enforced server-side, not just left to the client: a brand new invoice always
      // starts undispatched, no matter what billType it is or what the client sent —
      // printing a bill is not the same as the goods actually leaving.
      inv.dispatchStatus = 'Pending';
      inv.dispatchedAt = '';
    }

    inv = upsert_('Invoices', inv);

    // Batch-write invoice lines
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.invoiceId = inv.id;
        if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) - Number(l.qty || 0); // consume
        return toRow_('InvoiceItems', l);
      });
      var sh = getSheet_('InvoiceItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    adjustStock_(deltas);

    // Record initial payment (Payments sheet = source of truth)
    if (payload.payment && Number(payload.payment.amount) > 0) {
      upsert_('Payments', {
        date: inv.date,
        partyId: inv.partyId,
        partyName: inv.partyName,
        refType: 'Sale',
        refId: inv.id,
        amount: Number(payload.payment.amount),
        mode: payload.payment.mode || 'Cash',
        direction: 'In',
        notes: 'Received with invoice ' + inv.invNo
      });
    }

    return JSON.stringify({ ok: true, invoice: inv, items: readAll_('InvoiceItems').filter(function(l){ return l.invoiceId === inv.id; }) });
  });
}

/** Delete invoice: restores stock, removes lines and linked payments. */
function apiDeleteInvoice(id) {
  return withLock_(function() {
    var removed = deleteChildren_('InvoiceItems', 'invoiceId', id);
    var deltas = {};
    removed.forEach(function(l) {
      if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) + Number(l.qty || 0);
    });
    adjustStock_(deltas);
    deleteChildren_('Payments', 'refId', id);
    deleteById_('Invoices', id);
    return JSON.stringify({ ok: true });
  });
}

/**
 * Save purchase transactionally: stock IN + item cost update.
 * payload = { purchase, items:[...], payment: {amount, mode} | null }
 */
function apiSavePurchase(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var pur = payload.purchase;
    var lines = payload.items || [];
    var isEdit = !!pur.id && findRow_('Purchases', pur.id) > 0;

    var deltas = {};

    if (isEdit) {
      var oldLines = deleteChildren_('PurchaseItems', 'purchaseId', pur.id);
      oldLines.forEach(function(l) {
        if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) - Number(l.qty || 0); // reverse old IN
      });
    } else {
      if (!pur.billNo) {
        var settings = getSettings_();
        pur.billNo = settings.purPrefix + nextCounter_('PUR');
      }
      pur.createdAt = new Date().toISOString();
    }

    pur = upsert_('Purchases', pur);

    var costMap = {};
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.purchaseId = pur.id;
        if (l.itemId) {
          deltas[l.itemId] = (deltas[l.itemId] || 0) + Number(l.qty || 0);
          costMap[l.itemId] = Number(l.rate || 0);
        }
        return toRow_('PurchaseItems', l);
      });
      var sh = getSheet_('PurchaseItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    adjustStock_(deltas);
    updateItemCosts_(costMap);

    if (payload.payment && Number(payload.payment.amount) > 0) {
      upsert_('Payments', {
        date: pur.date,
        partyId: pur.partyId,
        partyName: pur.partyName,
        refType: 'Purchase',
        refId: pur.id,
        amount: Number(payload.payment.amount),
        mode: payload.payment.mode || 'Cash',
        direction: 'Out',
        notes: 'Paid with bill ' + pur.billNo
      });
    }

    return JSON.stringify({ ok: true, purchase: pur, items: readAll_('PurchaseItems').filter(function(l){ return l.purchaseId === pur.id; }) });
  });
}

function apiDeletePurchase(id) {
  return withLock_(function() {
    var removed = deleteChildren_('PurchaseItems', 'purchaseId', id);
    var deltas = {};
    removed.forEach(function(l) {
      if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) - Number(l.qty || 0);
    });
    adjustStock_(deltas);
    deleteChildren_('Payments', 'refId', id);
    deleteById_('Purchases', id);
    return JSON.stringify({ ok: true });
  });
}

// ---- Simple entity CRUD ----
function apiSaveItem(json)    { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('Items',    JSON.parse(json)) }); }); }
function apiSaveParty(json)   { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('Parties',  JSON.parse(json)) }); }); }
function apiSavePayment(json) { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('Payments', JSON.parse(json)) }); }); }
function apiDeleteItem(id)    { return withLock_(function(){ deleteById_('Items', id);    return JSON.stringify({ ok: true }); }); }
function apiDeleteParty(id)   { return withLock_(function(){ deleteById_('Parties', id); deleteChildren_('PartyContacts', 'partyId', id); return JSON.stringify({ ok: true }); }); }
function apiDeletePayment(id) { return withLock_(function(){ deleteById_('Payments', id); return JSON.stringify({ ok: true }); }); }

/** Bulk Payment Entry (Module 7): one physical amount handed over by/to a party, split
 * across several of their open documents in a single atomic write — e.g. a customer
 * pays 10,000 that happens to cover three separate invoices at once. Writes one
 * Payments row per allocation (so paidByRef/ledger/outstanding math on the client needs
 * no new logic, it already sums by refId), plus one extra row for any amount kept
 * "on account" (no refId) if the party paid more than their open documents needed.
 * payload = { date, partyId, partyName, mode, direction, notes,
 *             allocations: [{ refType, refId, amount }], onAccountAmount }
 */
function apiSaveBulkPayment(json) {
  return withLock_(function() {
    var p = JSON.parse(json);
    var records = (p.allocations || []).filter(function(a) { return Number(a.amount) > 0; }).map(function(a) {
      return upsert_('Payments', { id: '', date: p.date, partyId: p.partyId, partyName: p.partyName, refType: a.refType, refId: a.refId, amount: Number(a.amount), mode: p.mode, direction: p.direction, notes: p.notes || '' });
    });
    if (Number(p.onAccountAmount) > 0) {
      records.push(upsert_('Payments', { id: '', date: p.date, partyId: p.partyId, partyName: p.partyName, refType: 'OnAccount', refId: '', amount: Number(p.onAccountAmount), mode: p.mode, direction: p.direction, notes: p.notes || '' }));
    }
    return JSON.stringify({ ok: true, records: records });
  });
}

// ---- Party contacts (Module 2: CRM depth — one party can have many people) ----
function apiSaveContact(json) { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('PartyContacts', JSON.parse(json)) }); }); }
function apiDeleteContact(id) { return withLock_(function(){ deleteById_('PartyContacts', id); return JSON.stringify({ ok: true }); }); }

// ---- Opening balances (Module 3: seed historical bills that predate this system) ----
// Deliberately as simple as apiSaveItem/apiSaveParty above — no stock, no counters, no
// P&L impact, so it needs none of the transactional machinery those writes use.
function apiSaveOpeningBalance(json) { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('OpeningBalances', JSON.parse(json)) }); }); }
function apiDeleteOpeningBalance(id) { return withLock_(function(){ deleteById_('OpeningBalances', id); return JSON.stringify({ ok: true }); }); }

// ================= SALES SUITE (Module 4): Quotation -> Sales Order -> Invoice -> Return =================

/** Flip a document's status to 'Converted' without deleting it — the spec is explicit
 * that converting a Quotation/Sales Order must never remove the original record. */
function markConverted_(sheetName, id) {
  var row = findRow_(sheetName, id);
  if (row < 1) return;
  var col = SCHEMA[sheetName].indexOf('status') + 1;
  if (col > 0) getSheet_(sheetName).getRange(row, col).setValue('Converted');
}
function apiMarkConverted(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var allowed = ['Quotations', 'SalesOrders'];
    if (allowed.indexOf(payload.sheet) === -1) throw new Error('Cannot mark converted: ' + payload.sheet);
    markConverted_(payload.sheet, payload.id);
    return JSON.stringify({ ok: true });
  });
}

/** Quotations never touch stock — nothing has been promised or shipped yet. */
function apiSaveQuotation(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var quo = payload.quotation;
    var lines = payload.items || [];
    var isEdit = !!quo.id && findRow_('Quotations', quo.id) > 0;
    if (isEdit) {
      deleteChildren_('QuotationItems', 'quotationId', quo.id);
    } else {
      if (!quo.quoNo) {
        var settings = getSettings_();
        quo.quoNo = settings.quoPrefix + nextCounter_('QUO');
      }
      quo.createdAt = new Date().toISOString();
      quo.status = quo.status || 'Open';
    }
    quo = upsert_('Quotations', quo);
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.quotationId = quo.id;
        return toRow_('QuotationItems', l);
      });
      var sh = getSheet_('QuotationItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    return JSON.stringify({ ok: true, quotation: quo, items: readAll_('QuotationItems').filter(function(l){ return l.quotationId === quo.id; }) });
  });
}
function apiDeleteQuotation(id) {
  return withLock_(function() {
    deleteChildren_('QuotationItems', 'quotationId', id);
    deleteById_('Quotations', id);
    return JSON.stringify({ ok: true });
  });
}

/** Sales Orders are a confirmed commitment but still don't move stock — that only
 * happens once goods actually leave, at Invoice save (same rule as every other module). */
function apiSaveSalesOrder(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var so = payload.salesOrder;
    var lines = payload.items || [];
    var isEdit = !!so.id && findRow_('SalesOrders', so.id) > 0;
    if (isEdit) {
      deleteChildren_('SalesOrderItems', 'salesOrderId', so.id);
    } else {
      if (!so.soNo) {
        var settings = getSettings_();
        so.soNo = settings.soPrefix + nextCounter_('SO');
      }
      so.createdAt = new Date().toISOString();
      so.status = so.status || 'Open';
    }
    so = upsert_('SalesOrders', so);
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.salesOrderId = so.id;
        return toRow_('SalesOrderItems', l);
      });
      var sh = getSheet_('SalesOrderItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    return JSON.stringify({ ok: true, salesOrder: so, items: readAll_('SalesOrderItems').filter(function(l){ return l.salesOrderId === so.id; }) });
  });
}
function apiDeleteSalesOrder(id) {
  return withLock_(function() {
    deleteChildren_('SalesOrderItems', 'salesOrderId', id);
    deleteById_('SalesOrders', id);
    return JSON.stringify({ ok: true });
  });
}

/**
 * Save a Sales Return against an existing invoice — partial-line returns are the
 * normal case (a customer rarely returns 100% of a bill), so `items` only contains
 * the lines/quantities actually being returned, each tagged with the InvoiceItems
 * row (`invoiceItemId`) it came from so the UI can stop you over-returning a line.
 *
 * Stock comes back IN immediately (same adjustStock_ used everywhere else). The
 * receivable is reduced by writing a Payments row — Payments stays the ONE source of
 * truth for "how much of this invoice is settled," so Outstanding/party-balance/ledger
 * all keep working with zero changes. That payment's `id` is deliberately set equal to
 * this return's own id (not a random uuid): refId on it has to be the ORIGINAL INVOICE's
 * id (so paidByRef[invoiceId] includes it), which means refId can't also identify which
 * return produced it — reusing the return's id as the payment's id gives us an O(1) way
 * to find and remove exactly that one credit if the return is later deleted.
 */
function apiSaveSalesReturn(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var sr = payload.salesReturn;
    var lines = payload.items || [];
    if (!sr.id) {
      var settings = getSettings_();
      sr.id = Utilities.getUuid().slice(0, 8);
      sr.srNo = settings.srPrefix + nextCounter_('SR');
      sr.createdAt = new Date().toISOString();
      sr.status = 'Completed';
    }
    sr = upsert_('SalesReturns', sr);

    var deltas = {};
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.salesReturnId = sr.id;
        if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) + Number(l.qty || 0); // stock back IN
        return toRow_('SalesReturnItems', l);
      });
      var sh = getSheet_('SalesReturnItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    adjustStock_(deltas);

    if (Number(sr.total) > 0 && sr.sourceId) {
      upsert_('Payments', {
        id: sr.id,
        date: sr.date,
        partyId: sr.partyId,
        partyName: sr.partyName,
        refType: 'SalesReturn',
        refId: sr.sourceId,
        amount: Number(sr.total),
        mode: sr.srNo,
        direction: 'In',
        notes: 'Goods returned, return ' + sr.srNo
      });
    }

    return JSON.stringify({ ok: true, salesReturn: sr, items: readAll_('SalesReturnItems').filter(function(l){ return l.salesReturnId === sr.id; }) });
  });
}
/** Delete a Sales Return: reverses the stock-in and removes its linked credit (see the
 * apiSaveSalesReturn comment for why that credit's id equals this return's id). */
function apiDeleteSalesReturn(id) {
  return withLock_(function() {
    var removed = deleteChildren_('SalesReturnItems', 'salesReturnId', id);
    var deltas = {};
    removed.forEach(function(l) {
      if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) - Number(l.qty || 0); // reverse stock IN
    });
    adjustStock_(deltas);
    deleteById_('Payments', id);
    deleteById_('SalesReturns', id);
    return JSON.stringify({ ok: true });
  });
}

// ================= DISPATCH TRACKING (Module 5) =================
/**
 * Mark an invoice Dispatched or Revert it back to Pending. This is deliberately a status
 * flag on the existing Invoice, not a new document type — the real workflow is "an
 * invoice is printed, handed to a delivery person, and the goods may or may not leave
 * that same day," not a second inventory-moving document. Stock was already deducted
 * once, at Invoice save; this never touches it again. DispatchLog is audit-trail only.
 * payload = { invoiceId, action: 'Dispatched'|'Reverted', vehicleNo, transporter, notes }
 */
function apiMarkDispatch(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var row = findRow_('Invoices', payload.invoiceId);
    if (row < 1) throw new Error('Invoice not found');
    var headers = SCHEMA.Invoices;
    var sh = getSheet_('Invoices');
    var values = sh.getRange(row, 1, 1, headers.length).getValues()[0];
    var dispatched = payload.action === 'Dispatched';
    values[headers.indexOf('dispatchStatus')] = dispatched ? 'Dispatched' : 'Pending';
    values[headers.indexOf('dispatchedAt')] = dispatched ? new Date().toISOString() : '';
    sh.getRange(row, 1, 1, headers.length).setValues([values]);

    var invNo = values[headers.indexOf('invNo')];
    var partyName = values[headers.indexOf('partyName')];
    upsert_('DispatchLog', {
      invoiceId: payload.invoiceId,
      invNo: invNo,
      partyName: partyName,
      action: payload.action,
      vehicleNo: payload.vehicleNo || '',
      transporter: payload.transporter || '',
      notes: payload.notes || '',
      timestamp: new Date().toISOString(),
      userEmail: Session.getActiveUser().getEmail()
    });
    return JSON.stringify({ ok: true, dispatchStatus: dispatched ? 'Dispatched' : 'Pending', dispatchedAt: dispatched ? values[headers.indexOf('dispatchedAt')] : '' });
  });
}

/**
 * Upload a party's visiting card image to Drive and return its file URL.
 * payload = { partyId, name, mimeType, base64 }. Stored in a single app folder
 * (created on first use) so all visiting cards live in one place, not scattered
 * across the uploader's My Drive root.
 *
 * Deliberately does NOT change the file's sharing settings — a visiting card
 * has someone's personal name/phone on it, so it stays private to this
 * Google account (same access as the spreadsheet itself) instead of becoming
 * a public "anyone with the link" URL. Only someone already logged into the
 * account that owns this Sheet can open it, exactly like every other record
 * in this app.
 */
function apiUploadVisitingCard(payloadJson) {
  var payload = JSON.parse(payloadJson);
  var folderName = 'XL Traders ERP - Visiting Cards';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  var bytes = Utilities.base64Decode(payload.base64);
  var blob = Utilities.newBlob(bytes, payload.mimeType, payload.name || 'visiting-card');
  var file = folder.createFile(blob);
  return JSON.stringify({ ok: true, url: file.getUrl() });
}

// ---- Settings ----
function getSettings_() {
  var rows = readAll_('Settings');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === 'app') {
      try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(rows[i].value)); } catch (e) {}
    }
  }
  return DEFAULT_SETTINGS;
}

function apiSaveSettings(json) {
  return withLock_(function() {
    var sh = getSheet_('Settings');
    var last = sh.getLastRow();
    var written = false;
    if (last >= 2) {
      var keys = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i][0] === 'app') { sh.getRange(i + 2, 2).setValue(json); written = true; break; }
      }
    }
    if (!written) sh.appendRow(['app', json]);
    return JSON.stringify({ ok: true });
  });
}

/**
 * Convert an HTML string (the same markup the browser already uses for on-screen
 * printing) into a real PDF, so an invoice can be downloaded as a file instead of
 * only printed. Uses Apps Script's built-in HTML→PDF blob conversion — no
 * external PDF library needed. Read-only and stateless, so it doesn't need
 * withLock_ (nothing else is competing for a resource here).
 */
function apiHtmlToPdf(payloadJson) {
  var payload = JSON.parse(payloadJson);
  var blob = Utilities.newBlob(payload.html, 'text/html', payload.filename || 'document.html');
  var pdf = blob.getAs('application/pdf');
  return JSON.stringify({ ok: true, base64: Utilities.base64Encode(pdf.getBytes()) });
}

// ================= PURCHASE SUITE (Module 6) =================
/**
 * Purchase Return — the exact mirror of apiSaveSalesReturn (Module 4), reversed: stock
 * goes OUT (goods going back to the supplier) instead of in, and the payable is reduced
 * via a Payments row with direction 'Out' instead of 'In'. Same id-sharing trick: the
 * synthetic payment's id equals this return's id, so deleting the return can find and
 * remove exactly that one debit in O(1) — see the apiSaveSalesReturn comment for why.
 * payload = { purchaseReturn: {...}, items: [{ purchaseItemId, itemId, name, qty, rate, amount }] }
 */
function apiSavePurchaseReturn(payloadJson) {
  return withLock_(function() {
    var payload = JSON.parse(payloadJson);
    var pr = payload.purchaseReturn;
    var lines = payload.items || [];
    if (!pr.id) {
      var settings = getSettings_();
      pr.id = Utilities.getUuid().slice(0, 8);
      pr.prNo = settings.prPrefix + nextCounter_('PR');
      pr.createdAt = new Date().toISOString();
      pr.status = 'Completed';
    }
    pr = upsert_('PurchaseReturns', pr);

    var deltas = {};
    if (lines.length) {
      var rows = lines.map(function(l) {
        l.id = l.id || Utilities.getUuid().slice(0, 8);
        l.purchaseReturnId = pr.id;
        if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) - Number(l.qty || 0); // stock OUT
        return toRow_('PurchaseReturnItems', l);
      });
      var sh = getSheet_('PurchaseReturnItems');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    adjustStock_(deltas);

    if (Number(pr.total) > 0 && pr.sourceId) {
      upsert_('Payments', {
        id: pr.id,
        date: pr.date,
        partyId: pr.partyId,
        partyName: pr.partyName,
        refType: 'PurchaseReturn',
        refId: pr.sourceId,
        amount: Number(pr.total),
        mode: pr.prNo,
        direction: 'Out',
        notes: 'Goods returned to supplier, return ' + pr.prNo
      });
    }

    return JSON.stringify({ ok: true, purchaseReturn: pr, items: readAll_('PurchaseReturnItems').filter(function(l){ return l.purchaseReturnId === pr.id; }) });
  });
}
/** Delete a Purchase Return: reverses the stock-out and removes its linked debit. */
function apiDeletePurchaseReturn(id) {
  return withLock_(function() {
    var removed = deleteChildren_('PurchaseReturnItems', 'purchaseReturnId', id);
    var deltas = {};
    removed.forEach(function(l) {
      if (l.itemId) deltas[l.itemId] = (deltas[l.itemId] || 0) + Number(l.qty || 0); // reverse stock OUT
    });
    adjustStock_(deltas);
    deleteById_('Payments', id);
    deleteById_('PurchaseReturns', id);
    return JSON.stringify({ ok: true });
  });
}
