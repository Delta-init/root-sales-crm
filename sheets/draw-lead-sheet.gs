/**
 * DRAW LEAD SHEET → Root portal (Lead traffic), as TRADING-LEADS NITRO
 *
 * Replaces the script that posted this sheet straight into the Sales CRM. Every
 * new row now goes to the Root portal, which sends it on as set for this sheet
 * on Root's Lead traffic page — to start with, every lead to Delta's Sales CRM,
 * with the source label TRADING-LEADS NITRO, as before — and says where each one
 * went. The leads, and where they went, show on that page under TRADING-LEADS
 * NITRO. The sheet's ID on Root is set below; there is no SHEET_ID property.
 *
 * Two kinds of row, told apart by their values, as the old script did:
 *
 *   Typed in by hand (A:L)  A Name | B Phone Number | C Platform | D Course | E Email
 *                           F Status | G Assigned | H Remark | I–K Follow ups | L CRM Sync
 *   Meta's (A:O, X, AB)     A lead id (l:…) | B created time | C ad id | D ad name
 *                           E ad set id | F ad set name | G campaign id | H campaign name
 *                           I form id | J form name | K organic | L CRM Sync
 *                           M name | N phone | O email | X platform | AB Facebook's status
 *
 * Meta's rows are not under the header row's names (A:L name the hand-typed
 * columns), so this sheet has a script of its own rather than the shared
 * sheets/lead-traffic.gs, which finds columns by header name.
 *
 * The answer is written into column L, CRM Sync:
 *
 *   ✅ Delta                 sent
 *   ⚠️ Duplicate · Delta     already in that CRM (or sent before) — nothing new made
 *   ⏳ Waiting · Delta       Root has it; the CRM could not take it yet, Root keeps trying
 *   ⏸ Paused · Delta         routing is paused on Root; sent when it is resumed
 *   ❌ Invalid: …            not sent, and why (fix the row and it goes on the next run)
 *   — SKIPPED                no name or no phone yet
 *
 * Rows the old script already marked (✅ SYNCED, ⚠️ DUPLICATE) are left alone.
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

var SHEET_ID = "TRADING-LEADS NITRO"; // which sheet this is, on Root
var SHEET_NAME = "Sheet1";
var FIRST_DATA_ROW = 2;
var SYNC_COL = 12; // L
var READ_COLS = 28; // A:AB
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

function sheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('The tab "' + SHEET_NAME + '" was not found.');
  return sheet;
}

// ── Reading the rows ─────────────────────────────────────────────────────────

/** A cell as text: a date as its ISO time, a number (a phone typed as one) as its digits. */
function text_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v === null || v === undefined ? "" : v).trim();
}

/** Meta's: a lead id in A, or a created time in B with a phone in N. */
function isMeta_(r) {
  return /^l:/i.test(r[0]) || (/^\d{4}-\d{2}-\d{2}t/i.test(r[1]) && !!r[13]);
}

/** The row as Root takes it, or null without a name and a phone. `r` is the row's cells as text. */
function rowFor_(r, tab) {
  var meta = isMeta_(r);
  var name = meta ? r[12] : r[0]; // M, or A
  var phone = meta ? r[13] : r[1]; // N, or B
  if (!name || !phone) return null;
  if (!meta) {
    return { id: "", tab: tab, created_time: "", full_name: name, phone_number: phone, email: r[4], platform: r[2] || "Meta" };
  }
  return {
    id: r[0],
    tab: tab,
    created_time: r[1],
    full_name: name,
    phone_number: phone,
    email: r[14],
    platform: r[23] || "Meta",
    campaign_name: r[7],
    ad_name: r[3],
    adset_name: r[5],
    is_organic: r[10],
  };
}

/** Sent, or already somewhere: never asked about again. */
function isDone_(marker) {
  var s = String(marker || "").trim();
  return s.indexOf("✅") === 0 || s.indexOf("⚠️") === 0;
}

/** The rows to send — newest Meta leads first, then the rest, later rows first — and those with no name or phone. */
function pending_(sheet) {
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return { send: [], skip: [] };
  var values = sheet.getRange(FIRST_DATA_ROW, 1, last - FIRST_DATA_ROW + 1, READ_COLS).getValues();
  var tab = sheet.getName();
  var send = [];
  var skip = [];
  values.forEach(function (row, i) {
    var r = row.map(text_);
    while (r.length < READ_COLS) r.push("");
    var marker = r[SYNC_COL - 1];
    if (isDone_(marker)) return;
    var data = rowFor_(r, tab);
    var rowIndex = FIRST_DATA_ROW + i;
    if (!data) {
      if (!r.join("")) return; // an empty row
      if (!marker || marker.indexOf("❌") === 0) skip.push(rowIndex);
      return;
    }
    var created = data.created_time ? Date.parse(data.created_time) : NaN;
    send.push({ rowIndex: rowIndex, data: data, created: isNaN(created) ? 0 : created });
  });
  send.sort(function (a, b) { return b.created - a.created || b.rowIndex - a.rowIndex; });
  return { send: send, skip: skip };
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

function writeResults_(sheet, chunk, response) {
  var ok = response.code >= 200 && response.code < 300 && response.body && response.body.success;
  var results = ok && response.body.data ? response.body.data.results || [] : null;
  for (var i = 0; i < chunk.length; i++) {
    var target = sheet.getRange(chunk[i].rowIndex, SYNC_COL);
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

/** New rows, and any not yet ✅ or ⚠️. */
function syncPendingRows() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log("Another run is going — skipped."); return; }
  try {
    var cfg = config_();
    var sheet = sheet_();
    var p = pending_(sheet);
    p.skip.forEach(function (rowIndex) {
      sheet.getRange(rowIndex, SYNC_COL).setValue(SKIPPED).setBackground(null);
    });
    Logger.log("Sending " + p.send.length + " row(s); " + p.skip.length + " without a name or phone");
    for (var c = 0; c < p.send.length; c += CHUNK_SIZE) {
      var chunk = p.send.slice(c, c + CHUNK_SIZE);
      writeResults_(sheet, chunk, post_(cfg, chunk.map(function (x) { return x.data; })));
      Utilities.sleep(300);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** The old script's edit trigger, until Setup triggers replaces it: the same as a sync. */
function onEditSyncTrigger(e) {
  if (e && e.range && e.range.getSheet().getName() !== SHEET_NAME) return;
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
  var sheet = sheet_();
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) { safeAlert_("No lead rows."); return; }
  var markers = sheet.getRange(FIRST_DATA_ROW, SYNC_COL, last - FIRST_DATA_ROW + 1, 1).getValues();
  var counts = { "✅ sent": 0, "⚠️ already somewhere": 0, "⏳ waiting": 0, "⏸ paused": 0, "❌ not sent": 0, "— skipped": 0 };
  markers.forEach(function (m) {
    var s = text_(m[0]);
    if (s.indexOf("✅") === 0) counts["✅ sent"]++;
    else if (s.indexOf("⚠️") === 0) counts["⚠️ already somewhere"]++;
    else if (s.indexOf("⏳") === 0) counts["⏳ waiting"]++;
    else if (s.indexOf("⏸") === 0) counts["⏸ paused"]++;
    else if (s.indexOf("❌") === 0) counts["❌ not sent"]++;
    else if (s === SKIPPED) counts["— skipped"]++;
  });
  var p = pending_(sheet);
  safeAlert_(Object.keys(counts).map(function (k) { return k + ": " + counts[k]; }).join("\n") + "\n\nTo send now: " + p.send.length);
}

function previewPending() {
  var p = pending_(sheet_());
  var lines = [p.send.length + " to send"];
  for (var i = 0; i < Math.min(p.send.length, 5); i++) lines.push("   row " + p.send[i].rowIndex + " | " + p.send[i].data.full_name);
  safeAlert_(lines.join("\n"));
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
