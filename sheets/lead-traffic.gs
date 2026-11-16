/**
 * Delta — Lead traffic → Root portal
 *
 * One script for every lead sheet that goes through Root. It replaces the
 * script that posted the sheet straight into a CRM: every new row now goes to
 * the Root portal, which splits the leads between the Delta and Draw CRMs as
 * set for this sheet on Root's Lead traffic page, and says where each one
 * went. The sheet is told which it is by the SHEET_ID Script property:
 *
 *   abhin    Abhin's automated Meta lead sheet — split by tab: UK, GCC, Hindi
 *   shoaib   Shoaib's Forex leads sheet — one split for the whole sheet
 *
 * The DRAW LEAD SHEET (TRADING-LEADS NITRO) has a script of its own,
 * draw-lead-sheet.gs: its Meta rows are not laid out under its headers, so they
 * cannot be found by header name.
 *
 * The answer is written into the "CRM Sync" column:
 *
 *   ✅ Delta / ✅ Draw          sent
 *   ✅ Delta → Nusra           sent, straight to that person
 *   ⚠️ Duplicate · Delta       already in that CRM (or sent before) — nothing new made
 *   ⏳ Waiting · Draw          Root has it; that CRM could not take it yet, Root keeps trying
 *   ⏸ Paused · Draw            routing is paused on Root; sent when it is resumed
 *   ❌ Invalid: …              not sent, and why (fix the row and it goes on the next run)
 *
 * Columns are found BY HEADER NAME, so a tab whose columns are in another
 * order (the GCC tab has phone_number before email) works the same as the rest.
 * Any tab with full_name, a phone column and created_time is a lead tab. The
 * ad set (adset_name) and a trading-knowledge question column are sent too,
 * where a sheet has them.
 *
 * Setup, once per sheet:
 *   1. Extensions → Apps Script: replace the old script's code with this file.
 *   2. Project Settings → Script properties:
 *        ROOT_API_URL   https://root-api-sales-crm.deltainstitutions.com
 *        TRAFFIC_KEY    the LEAD_TRAFFIC_SHEET_KEY set on the Root server
 *        SHEET_ID       abhin, or shoaib
 *   3. Reload the sheet. 🔀 Lead traffic → Test connection (it names the
 *      sheet Root thinks this is), then Setup triggers (which also removes the
 *      old script's triggers).
 *
 * The lead's status in its CRM (Follow Up, Closed, CNC, …) is written into a
 * "CRM Status" column beside it every 30 minutes (2026-11-16), for every row
 * already sent — the old ✅ SYNCED rows too, found by phone. 🔄 Refresh CRM
 * status now does it at once; the first run fills every old row. Empty: the
 * lead is not in any CRM (or that CRM could not be read just then).
 *
 * Rows the old scripts already marked (✅ SYNCED, ✅ SYNCED → NUSRA,
 * ⚠️ DUPLICATE) are left alone. Rows marked ❌ ERROR were not taken by the CRM
 * and are sent again.
 */

var CHUNK_SIZE = 100;
var EXCLUDED_SHEETS = ["Summary", "Dashboard", "Config", "README"];
var SYNC_HEADER = "CRM Sync";
// The lead's status in its CRM, written back every 30 minutes (2026-11-16). Not "lead_status": that is Meta's own column.
var STATUS_HEADER = "CRM Status";
var STATUS_CHUNK = 200;
// Stop well inside Apps Script's 6 minutes; the next run carries on from the row it stopped at.
var STATUS_BUDGET_MS = 4.5 * 60 * 1000;
var STATUS_COLORS = {
  "Closed": "#d9ead3", "Follow Up": "#cfe2f3", "Call Back": "#cfe2f3", "Interested": "#cfe2f3",
  "Meeting Scheduled": "#d9d2e9", "Meeting Done": "#d9d2e9",
  "Lost": "#f4cccc", "Wrong Number": "#f4cccc", "CNC": "#fce5cd", "Not Connected": "#fce5cd", "MIA": "#fce5cd",
};

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
  // Never guessed: a sheet sent as another would be split by the other's rules.
  var sheet = String(p.getProperty("SHEET_ID") || "").trim().toLowerCase();
  if (!url || !key || !sheet) {
    throw new Error("Set ROOT_API_URL, TRAFFIC_KEY and SHEET_ID in Project Settings → Script properties.");
  }
  return { url: url, key: key, sheet: sheet };
}

function safeAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log("ALERT: " + msg); }
}

// ── Reading a tab ────────────────────────────────────────────────────────────

/** Header name → column (0-based). Null when the tab is not a lead tab. */
function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v || "").trim().toLowerCase();
  });
  var find = function (pred) {
    for (var i = 0; i < h.length; i++) if (pred(h[i])) return i;
    return -1;
  };
  var m = {
    id: find(function (x) { return x === "id"; }),
    created: find(function (x) { return x === "created_time"; }),
    name: find(function (x) { return x === "full_name"; }),
    phone: find(function (x) { return x.indexOf("phone") !== -1; }),
    email: find(function (x) { return x === "email"; }),
    platform: find(function (x) { return x === "platform"; }),
    campaign: find(function (x) { return x === "campaign_name"; }),
    ad: find(function (x) { return x === "ad_name"; }),
    adset: find(function (x) { return x === "adset_name"; }),
    knowledge: find(function (x) { return x.indexOf("knowledge") !== -1; }),
    organic: find(function (x) { return x === "is_organic"; }),
    sync: find(function (x) { return x === SYNC_HEADER.toLowerCase(); }),
    status: find(function (x) { return x === STATUS_HEADER.toLowerCase(); }),
  };
  if (m.name === -1 || m.phone === -1 || m.created === -1) return null;
  return m;
}

/** The CRM Sync column, added after the last header if the tab has none yet. */
function syncColumn_(sheet, m, create) {
  if (m.sync !== -1) return m.sync;
  if (!create) return -1;
  var col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(SYNC_HEADER).setFontWeight("bold").setBackground("#cfe2f3");
  sheet.setColumnWidth(col, 220);
  return col - 1;
}

function text_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v === null || v === undefined ? "" : v).trim();
}

/** Sent, or already somewhere: never asked about again. */
function isDone_(marker) {
  var s = String(marker || "").trim();
  return s.indexOf("✅") === 0 || s.indexOf("⚠️") === 0;
}

function buildBatch_(sheet, pendingOnly, create) {
  var m = headerMap_(sheet);
  if (!m) return null;
  var syncIdx = syncColumn_(sheet, m, create);
  var data = sheet.getDataRange().getValues();
  var tab = sheet.getName();
  var cell = function (row, idx) { return idx === -1 ? "" : text_(row[idx]); };
  var batch = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var name = cell(row, m.name);
    var phone = cell(row, m.phone);
    if (!name && !phone) continue;
    if (pendingOnly && syncIdx !== -1 && isDone_(row[syncIdx])) continue;
    batch.push({
      rowIndex: i + 1,
      data: {
        id: cell(row, m.id),
        tab: tab,
        created_time: cell(row, m.created),
        full_name: name,
        phone_number: phone,
        email: cell(row, m.email),
        platform: cell(row, m.platform),
        campaign_name: cell(row, m.campaign),
        ad_name: cell(row, m.ad),
        adset_name: cell(row, m.adset),
        knowledge: cell(row, m.knowledge),
        is_organic: cell(row, m.organic),
      },
    });
  }
  return { batch: batch, syncCol: syncIdx + 1 };
}

// ── CRM Status: each sent lead's status in its CRM, every 30 minutes ─────────

/** The CRM Status column, added after the last column if the tab has none yet. */
function statusColumn_(sheet, m) {
  if (m.status !== -1) return m.status;
  var col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(STATUS_HEADER).setFontWeight("bold").setBackground("#d9ead3");
  sheet.setColumnWidth(col, 150);
  return col - 1;
}

function postStatuses_(cfg, rows) {
  try {
    var res = UrlFetchApp.fetch(cfg.url + "/api/v1/traffic/statuses", {
      method: "post",
      contentType: "application/json",
      headers: { "x-traffic-key": cfg.key },
      payload: JSON.stringify({ sheet: cfg.sheet, rows: rows }),
      muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    if (res.getResponseCode() !== 200) Logger.log("Root statuses → HTTP " + res.getResponseCode() + " | " + res.getContentText().substring(0, 300));
    return res.getResponseCode() === 200 && body && body.success && body.data ? body.data.results || null : null;
  } catch (err) {
    Logger.log("Root unreachable: " + err);
    return null;
  }
}

/**
 * One tab: every row already sent (✅ or ⚠️), asked of Root 200 at a time, and only the cells whose status changed
 * written. Returns false when it ran out of time — `startAt` is kept, and the next run carries on from there.
 */
function refreshTab_(cfg, sheet, started) {
  var m = headerMap_(sheet);
  if (!m || m.sync === -1) return true;
  var data = sheet.getDataRange().getValues();
  var statusIdx = statusColumn_(sheet, m);
  var props = PropertiesService.getScriptProperties();
  var resumeKey = "STATUS_RESUME_" + sheet.getSheetId();
  var startAt = Number(props.getProperty(resumeKey) || 1);
  if (!(startAt >= 1 && startAt < data.length)) startAt = 1;
  var cell = function (row, idx) { return idx === -1 ? "" : text_(row[idx]); };

  var asked = [];
  for (var i = startAt; i < data.length; i++) {
    if (!isDone_(data[i][m.sync])) continue;
    asked.push({ i: i, data: { id: cell(data[i], m.id), tab: sheet.getName(), created_time: cell(data[i], m.created), phone_number: cell(data[i], m.phone) } });
  }
  for (var c = 0; c < asked.length; c += STATUS_CHUNK) {
    if (Date.now() - started > STATUS_BUDGET_MS) {
      props.setProperty(resumeKey, String(asked[c].i));
      Logger.log("[" + sheet.getName() + "] out of time — carries on from row " + (asked[c].i + 1) + " next run");
      return false;
    }
    var chunk = asked.slice(c, c + STATUS_CHUNK);
    var results = postStatuses_(cfg, chunk.map(function (x) { return x.data; }));
    if (!results) continue; // Root not answering: those rows keep what they show
    // One read and one write for the chunk's stretch of the column, rather than a call per cell.
    var first = chunk[0].i, last = chunk[chunk.length - 1].i;
    var range = sheet.getRange(first + 1, statusIdx + 1, last - first + 1, 1);
    var values = range.getValues(), colors = range.getBackgrounds(), changed = false;
    for (var k = 0; k < chunk.length; k++) {
      var r = results[k];
      if (!r) continue;
      var at = chunk[k].i - first;
      var next = String(r.status || "");
      if (text_(values[at][0]) === next) continue;
      values[at][0] = next;
      colors[at][0] = STATUS_COLORS[next] || "#ffffff";
      changed = true;
    }
    if (changed) { range.setValues(values); range.setBackgrounds(colors); }
    Utilities.sleep(200);
  }
  props.deleteProperty(resumeKey);
  return true;
}

function refreshStatuses_() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(60000); } catch (e) { Logger.log("Another run is going — status refresh skipped."); return; }
  var started = Date.now();
  try {
    var cfg = config_();
    var tabs = targetSheets_();
    for (var t = 0; t < tabs.length; t++) {
      try { if (!refreshTab_(cfg, tabs[t], started)) break; }
      catch (err) { Logger.log("[" + tabs[t].getName() + "] status: " + err); }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Every 30 minutes (Setup triggers), and from the menu. */
function statusRefresh() {
  try { refreshStatuses_(); } catch (err) { Logger.log("statusRefresh: " + err); }
}

function refreshStatusesNow() {
  refreshStatuses_();
  safeAlert_("✅ CRM Status refreshed. A long sheet may need one more run to fill every row — it carries on by itself every 30 minutes.");
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

function writeResults_(sheet, chunk, syncCol, response) {
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

function syncSheet_(cfg, sheet, pendingOnly) {
  var built = buildBatch_(sheet, pendingOnly, true);
  if (!built) { Logger.log("[" + sheet.getName() + "] not a lead tab — skipped"); return; }
  if (!built.batch.length) { Logger.log("[" + sheet.getName() + "] nothing to send"); return; }
  Logger.log("[" + sheet.getName() + "] sending " + built.batch.length + " row(s)");
  for (var c = 0; c < built.batch.length; c += CHUNK_SIZE) {
    var chunk = built.batch.slice(c, c + CHUNK_SIZE);
    var response = post_(cfg, chunk.map(function (x) { return x.data; }));
    writeResults_(sheet, chunk, built.syncCol, response);
    Utilities.sleep(300);
  }
}

function targetSheets_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (s) {
    return EXCLUDED_SHEETS.indexOf(s.getName()) === -1;
  });
}

function run_(pendingOnly) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(60000); } catch (e) { Logger.log("Another run is going — skipped."); return; }
  try {
    var cfg = config_();
    targetSheets_().forEach(function (sheet) {
      try { syncSheet_(cfg, sheet, pendingOnly); }
      catch (err) { Logger.log("[" + sheet.getName() + "] " + err); }
    });
  } finally {
    lock.releaseLock();
  }
}

// ── Menu actions and triggers ────────────────────────────────────────────────

/** New rows, and any not yet ✅ or ⚠️. */
function syncPendingRows() { run_(true); }

/**
 * Every row, marked or not. Safe: Root answers a row it has seen from what it
 * decided then, and a row the old script sent is found already in Delta and
 * marked a duplicate — nothing is sent twice.
 */
function recheckAllRows() { run_(false); }

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
  // Each lead's status from its CRM into the CRM Status column (2026-11-16).
  ScriptApp.newTrigger("statusRefresh").timeBased().everyMinutes(30).create();
  safeAlert_("✅ Triggers installed: send on every change to the sheet and every 15 minutes; CRM Status every 30 minutes.");
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

function previewPending() {
  var lines = [];
  targetSheets_().forEach(function (sheet) {
    var built = buildBatch_(sheet, true, false);
    if (!built) { lines.push(sheet.getName() + " → not a lead tab"); return; }
    lines.push(sheet.getName() + " → " + built.batch.length + " to send");
    for (var i = 0; i < Math.min(built.batch.length, 3); i++) {
      lines.push("   row " + built.batch[i].rowIndex + " | " + built.batch[i].data.full_name);
    }
  });
  safeAlert_(lines.length ? lines.join("\n") : "Nothing to send.");
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🔀 Lead traffic")
      .addItem("Send new rows now", "syncPendingRows")
      .addItem("Re-check every row", "recheckAllRows")
      .addItem("🔄 Refresh CRM status now", "refreshStatusesNow")
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
