/**
 * JURA LEADS → Root portal (Lead traffic), as "Jura leads"
 *
 * Replaces the script that posted this sheet straight into the Sales CRM. Every
 * new row now goes to the Root portal, which sends it on as set for this sheet
 * on Root's Lead traffic page — to start with, every lead to Remote CRM, for
 * Vishnu R Nath, labelled JURA LEADS — and says where each one went.
 *
 * Every tab with a name column and a phone column is read, columns found by
 * their header, so both kinds of tab work and a new Meta form tab does too:
 *
 *   Typed in by hand (Sheet1)  Name | Phone Number | Platform | Course | Mail
 *                              Status | Remarks | Follow Up 1–4 | CRM Sync
 *                              No created time: Root dates it when it arrives.
 *                              Course, status, remarks and follow-ups go into
 *                              the CRM lead's note, as the old script did.
 *   Meta's lead forms          id | created_time | … | full_name | phone_number
 *                              | email | … — the ad and ad set go into the note.
 *
 * The answer is written into the tab's "CRM Sync" column (made if missing):
 *
 *   ✅ Remote                sent
 *   ⚠️ Duplicate · Remote    already in Remote CRM (or sent before) — nothing new made
 *   ⏳ Waiting · Remote      Root has it; the CRM could not take it yet, Root keeps trying
 *   ⏸ Paused · Remote        routing is paused on Root; sent when it is resumed
 *   ❌ Invalid: …            not sent, and why (fix the row and it goes on the next run)
 *   — SKIPPED                no name or no phone yet
 *
 * Rows the old script already marked (✅ SYNCED, ⚠️ DUPLICATE) are left alone:
 * those leads are in the Sales CRM and are not sent again.
 *
 * Setup, once:
 *   1. Extensions → Apps Script: replace the old script's code with this file.
 *   2. Project Settings → Script properties:
 *        ROOT_API_URL   https://root-api-sales-crm.deltainstitutions.com
 *        TRAFFIC_KEY    the LEAD_TRAFFIC_SHEET_KEY set on the Root server
 *      The old script's CRM key is not needed any more, and is not kept in this code.
 *   3. Reload the sheet. 🔀 Lead traffic → Test connection, then Setup triggers
 *      (which also removes the old script's triggers).
 */

var SHEET_ID = "jura-leads"; // which sheet this is, on Root
var SYNC_HEADER = "CRM Sync";
var CHUNK_SIZE = 100; // Root takes up to 200 rows a request
var SKIPPED = "— SKIPPED";

var COLORS = {
  "✅": "#d9ead3",
  "⚠️": "#fff2cc",
  "⏳": "#fce5cd",
  "⏸": "#efefef",
  "❌": "#f4cccc",
};

// ── Settings ─────────────────────────────────────────────────────────────────

function config_() {
  var p = PropertiesService.getScriptProperties();
  var url = String(p.getProperty("ROOT_API_URL") || "").trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  var key = String(p.getProperty("TRAFFIC_KEY") || "").trim();
  if (!url || !key) throw new Error("Set ROOT_API_URL and TRAFFIC_KEY in Project Settings → Script properties.");
  return { url: url, key: key, sheet: SHEET_ID };
}

function safeAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log("ALERT: " + msg); }
}

// ── Reading the rows ─────────────────────────────────────────────────────────

/** A cell as text: a date as its ISO time, a number (a phone typed as one) as its digits. */
function text_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v === null || v === undefined ? "" : v).trim();
}

/** A header as it is compared: lower case, spaces as one, no stray spaces ("Name " is "name"). */
function key_(h) {
  return text_(h).toLowerCase().replace(/\s+/g, " ");
}

/** Where each column is on a tab, by its header; null when the tab has no name or no phone column. */
function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1 || sheet.getLastRow() < 1) return null;
  var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(key_);
  var at = function (pred) { for (var i = 0; i < h.length; i++) if (h[i] && pred(h[i])) return i; return -1; };
  var all = function (pred) { var out = []; for (var i = 0; i < h.length; i++) if (h[i] && pred(h[i])) out.push(i); return out; };
  var m = {
    id: at(function (x) { return x === "id"; }),
    created: at(function (x) { return x === "created_time"; }),
    name: at(function (x) { return x === "full_name" || x === "name"; }),
    phone: at(function (x) { return x.indexOf("phone") !== -1; }),
    email: at(function (x) { return x === "email" || x === "mail" || x === "e-mail"; }),
    platform: at(function (x) { return x === "platform"; }),
    campaign: at(function (x) { return x === "campaign_name"; }),
    ad: at(function (x) { return x === "ad_name"; }),
    adset: at(function (x) { return x === "adset_name"; }),
    organic: at(function (x) { return x === "is_organic"; }),
    course: at(function (x) { return x === "course"; }),
    status: at(function (x) { return x === "status"; }),
    remarks: at(function (x) { return x === "remarks" || x === "remark"; }),
    followUps: all(function (x) { return x.indexOf("follow up") === 0 || x.indexOf("follow-up") === 0; }),
    sync: at(function (x) { return x === SYNC_HEADER.toLowerCase(); }),
    width: h.length,
  };
  if (m.name === -1 || m.phone === -1) return null;
  return m;
}

/** The tab's CRM Sync column (1-based), made after the last header when it has none and `create` is set. */
function syncColumn_(sheet, m, create) {
  if (m.sync !== -1) return m.sync + 1;
  if (!create) return -1;
  var col = m.width + 1;
  sheet.getRange(1, col).setValue(SYNC_HEADER).setFontWeight("bold").setBackground("#cfe2f3");
  m.sync = col - 1;
  m.width = col;
  return col;
}

/** What a hand-kept row says beside the name and number, as the CRM note's first lines. */
function details_(r, m) {
  var cell = function (i) { return i === -1 ? "" : r[i] || ""; };
  var lines = [];
  if (cell(m.course)) lines.push("Course: " + cell(m.course));
  if (cell(m.status)) lines.push("Status: " + cell(m.status));
  if (cell(m.remarks)) lines.push("Remarks: " + cell(m.remarks));
  m.followUps.forEach(function (i, n) { if (cell(i)) lines.push("Follow up " + (n + 1) + ": " + cell(i)); });
  return lines.join("\n");
}

/** The row as Root takes it, or null without a name and a phone. `r` is the row's cells as text. */
function rowFor_(r, m, tab) {
  var cell = function (i) { return i === -1 ? "" : r[i] || ""; };
  var name = cell(m.name);
  var phone = cell(m.phone);
  if (!name || !phone) return null;
  var row = {
    id: cell(m.id),
    tab: tab,
    created_time: cell(m.created),
    full_name: name,
    phone_number: phone,
    email: cell(m.email),
    platform: cell(m.platform) || "Meta",
    campaign_name: cell(m.campaign),
    ad_name: cell(m.ad),
    adset_name: cell(m.adset),
    is_organic: cell(m.organic),
  };
  var d = details_(r, m);
  if (d) row.details = d;
  return row;
}

/** Sent, or already somewhere: never asked about again. */
function isDone_(marker) {
  var s = String(marker || "").trim();
  return s.indexOf("✅") === 0 || s.indexOf("⚠️") === 0;
}

/** One tab's rows to send — newest first — and those with no name or phone. Null for a tab that is not a lead tab. */
function pending_(sheet, create) {
  var m = headerMap_(sheet);
  if (!m) return null;
  var last = sheet.getLastRow();
  if (last < 2) return { sheet: sheet, send: [], skip: [], syncCol: -1 };
  var values = sheet.getRange(2, 1, last - 1, m.width).getValues();
  var syncCol = syncColumn_(sheet, m, create);
  var tab = sheet.getName();
  var send = [];
  var skip = [];
  values.forEach(function (row, i) {
    var r = row.map(text_);
    var marker = syncCol === -1 ? "" : r[syncCol - 1] || "";
    if (isDone_(marker)) return;
    var data = rowFor_(r, m, tab);
    var rowIndex = 2 + i;
    if (!data) {
      if (!r.join("")) return; // an empty row
      if (!marker || marker.indexOf("❌") === 0) skip.push(rowIndex);
      return;
    }
    var created = data.created_time ? Date.parse(data.created_time) : NaN;
    send.push({ rowIndex: rowIndex, data: data, created: isNaN(created) ? 0 : created });
  });
  send.sort(function (a, b) { return b.created - a.created || b.rowIndex - a.rowIndex; });
  return { sheet: sheet, send: send, skip: skip, syncCol: syncCol };
}

/** Every lead tab's pending rows. */
function allPending_(create) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function (s) { return pending_(s, create); }).filter(function (p) { return p; });
}

// ── Talking to Root ──────────────────────────────────────────────────────────

function post_(cfg, rows) {
  try {
    var res = UrlFetchApp.fetch(cfg.url + "/api/v1/traffic/intake", {
      method: "post",
      contentType: "application/json",
      headers: { "x-traffic-key": cfg.key },
      payload: JSON.stringify({ sheet: cfg.sheet, rows: rows }),
      muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    Logger.log("Root → HTTP " + res.getResponseCode() + " | " + res.getContentText().substring(0, 300));
    return { code: res.getResponseCode(), body: body };
  } catch (err) {
    Logger.log("Root unreachable: " + err);
    return { code: 0, body: { message: String(err) } };
  }
}

function colorFor_(label) {
  for (var k in COLORS) if (label.indexOf(k) === 0) return COLORS[k];
  return null;
}

function writeResults_(sheet, syncCol, chunk, response) {
  var ok = response.code >= 200 && response.code < 300 && response.body && response.body.success;
  var results = ok && response.body.data ? response.body.data.results || [] : null;
  for (var i = 0; i < chunk.length; i++) {
    var target = sheet.getRange(chunk[i].rowIndex, syncCol);
    var r = null;
    if (results) for (var j = 0; j < results.length; j++) if (results[j].index === i) { r = results[j]; break; }
    if (r) {
      target.setValue(r.label);
      target.setBackground(colorFor_(r.label));
      target.setNote(
        (r.crmLeadId ? "CRM lead: " + r.crmLeadId + "\n" : "") +
        (r.reason ? r.reason + "\n" : "") +
        "Checked: " + new Date().toISOString()
      );
    } else {
      // Root never took it, so nothing was decided: the next run sends it again.
      target.setValue("⏳ Not sent yet — will retry");
      target.setBackground(COLORS["⏳"]);
      target.setNote("Root did not take it: " + ((response.body && response.body.message) || "HTTP " + response.code) + "\n" + new Date().toISOString());
    }
  }
}

// ── Menu actions and triggers ────────────────────────────────────────────────

/** New rows on every lead tab, and any not yet ✅ or ⚠️. */
function syncPendingRows() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log("Another run is going — skipped."); return; }
  try {
    var cfg = config_();
    allPending_(true).forEach(function (p) {
      p.skip.forEach(function (rowIndex) { p.sheet.getRange(rowIndex, p.syncCol).setValue(SKIPPED).setBackground(null); });
      Logger.log("[" + p.sheet.getName() + "] sending " + p.send.length + " row(s); " + p.skip.length + " without a name or phone");
      for (var c = 0; c < p.send.length; c += CHUNK_SIZE) {
        var chunk = p.send.slice(c, c + CHUNK_SIZE);
        writeResults_(p.sheet, p.syncCol, chunk, post_(cfg, chunk.map(function (x) { return x.data; })));
        Utilities.sleep(300);
      }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** The old script's edit trigger, until Setup triggers replaces it: the same as a sync. */
function onEditSyncTrigger(e) {
  try { syncPendingRows(); } catch (err) { Logger.log("onEditSyncTrigger: " + err); }
}

function onSheetChange(e) {
  try { syncPendingRows(); } catch (err) { Logger.log("onSheetChange: " + err); }
}

function scheduledSync() {
  try { syncPendingRows(); } catch (err) { Logger.log("scheduledSync: " + err); }
}

function setupTriggers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onSheetChange").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("scheduledSync").timeBased().everyMinutes(15).create();
  safeAlert_("✅ Triggers installed: on every change to the sheet, and every 15 minutes.");
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  safeAlert_("🗑 All triggers removed. Nothing is sent until they are set up again.");
}

function testConnection() {
  try {
    var cfg = config_();
    var res = UrlFetchApp.fetch(cfg.url + "/api/v1/traffic/intake/ping?sheet=" + encodeURIComponent(cfg.sheet), {
      headers: { "x-traffic-key": cfg.key },
      muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(res.getContentText() || "{}"); } catch (e) {}
    if (res.getResponseCode() === 200 && body.success) {
      var crms = (body.data.crms || []).map(function (c) { return (c.ready ? "✅ " : "❌ ") + c.name; }).join("\n");
      safeAlert_("✅ Connected to Root as " + (body.data.name || cfg.sheet) + ".\nRouting: " +
        (body.data.paused ? "PAUSED" : "on") + "\n\n" + crms);
    } else {
      safeAlert_("❌ Root answered " + res.getResponseCode() + ": " + (body.message || res.getContentText()));
    }
  } catch (e) {
    safeAlert_("❌ " + e);
  }
}

function showSyncStatus() {
  var counts = { "✅ sent": 0, "⚠️ already somewhere": 0, "⏳ waiting": 0, "⏸ paused": 0, "❌ not sent": 0, "— skipped": 0 };
  var toSend = 0;
  allPending_(false).forEach(function (p) {
    toSend += p.send.length;
    var last = p.sheet.getLastRow();
    if (p.syncCol === -1 || last < 2) return;
    p.sheet.getRange(2, p.syncCol, last - 1, 1).getValues().forEach(function (v) {
      var s = text_(v[0]);
      if (s.indexOf("✅") === 0) counts["✅ sent"]++;
      else if (s.indexOf("⚠️") === 0) counts["⚠️ already somewhere"]++;
      else if (s.indexOf("⏳") === 0) counts["⏳ waiting"]++;
      else if (s.indexOf("⏸") === 0) counts["⏸ paused"]++;
      else if (s.indexOf("❌") === 0) counts["❌ not sent"]++;
      else if (s === SKIPPED) counts["— skipped"]++;
    });
  });
  safeAlert_(Object.keys(counts).map(function (k) { return k + ": " + counts[k]; }).join("\n") + "\n\nTo send now: " + toSend);
}

function previewPending() {
  var lines = [];
  allPending_(false).forEach(function (p) {
    lines.push(p.sheet.getName() + ": " + p.send.length + " to send");
    for (var i = 0; i < Math.min(p.send.length, 3); i++) lines.push("   row " + p.send[i].rowIndex + " | " + p.send[i].data.full_name);
  });
  safeAlert_(lines.join("\n") || "No lead tabs.");
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🔀 Lead traffic")
      .addItem("Send new rows now", "syncPendingRows")
      .addItem("Sync status…", "showSyncStatus")
      .addSeparator()
      .addItem("👁 Preview what will be sent", "previewPending")
      .addItem("🔌 Test connection", "testConnection")
      .addItem("⚙️ Setup triggers", "setupTriggers")
      .addItem("🗑 Remove triggers", "removeTriggers")
      .addToUi();
  } catch (e) {
    Logger.log("onOpen: " + e);
  }
}
