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
  Invoices: ['id','invNo','date','partyId','partyName','subTotal','discount','taxPct','taxAmt','total','payMode','status','notes','createdAt'],
  InvoiceItems: ['id','invoiceId','itemId','name','brand','packing','packs','qty','rate','amount','cost'],
  Purchases: ['id','billNo','date','partyId','partyName','subTotal','other','total','payMode','notes','createdAt'],
  PurchaseItems: ['id','purchaseId','itemId','name','qty','rate','amount'],
  Payments: ['id','date','partyId','partyName','refType','refId','amount','mode','direction','notes'],
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
    payments: readAll_('Payments')
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

// ---- Party contacts (Module 2: CRM depth — one party can have many people) ----
function apiSaveContact(json) { return withLock_(function(){ return JSON.stringify({ ok: true, record: upsert_('PartyContacts', JSON.parse(json)) }); }); }
function apiDeleteContact(id) { return withLock_(function(){ deleteById_('PartyContacts', id); return JSON.stringify({ ok: true }); }); }

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
