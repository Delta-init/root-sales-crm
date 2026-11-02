/*
 * The office TVs' photos and videos (Root, 2026-11-02): served by Root's API at /api/v1/public/tv/overlay.js and
 * loaded by every public TV page with one tag —
 *
 *   <script async src="https://<root api>/api/v1/public/tv/overlay.js?screen=<key>"></script>
 *
 * On the TV it plays that screen's photos and videos full screen, one after another, then steps aside for the board
 * for its board time (a minute), and again. The board underneath keeps running throughout. Root admins choose what
 * plays on the TV media page.
 *
 * - Photos stay up for their own seconds; videos play to the end, muted (browsers block sound on a video that starts
 *   by itself).
 * - A page announcing a sale fires `window.dispatchEvent(new Event("tv:celebrate"))`: the photos go at once so the
 *   celebration shows, and the board gets its full time again.
 * - A page turned on its side sets <html data-tv-rotate="90|180|270">; the photos turn with it — at once, even in the
 *   middle of a photo or video, when the page is turned (its Rotate button or R key) while they're showing.
 * - ?tvmedia=off on a TV's link turns this off for that screen.
 * - Anything going wrong — Root unreachable, a file missing — leaves the board on screen as it always was.
 *
 * Plain older JavaScript on purpose: TV browsers can be old.
 */
(function () {
  "use strict";
  try {
    if (window.__deltaTvOverlay) return;
    var me = document.currentScript || (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) if ((all[i].src || "").indexOf("/public/tv/overlay.js") !== -1) return all[i];
      return null;
    })();
    if (!me || !me.src) return;
    var src = new URL(me.src, window.location.href);
    var screen = src.searchParams.get("screen") || me.getAttribute("data-screen") || "";
    if (!screen || /(^|[?&])tvmedia=off(&|$)/i.test(window.location.search)) return;
    var api = src.origin + "/api/v1/public/tv/" + encodeURIComponent(screen);

    var list = { enabled: false, boardSeconds: 60, items: [], refreshSeconds: 120 };
    var started = false;
    var inBreak = false;
    var run = 0; // bumped whenever a break starts or ends, so a late timer from an older one does nothing
    var boardTimer = null;
    var stepTimer = null;
    var layer = null;
    var stage = null;
    var current = null;

    window.__deltaTvOverlay = {
      screen: screen,
      state: function () { return { inBreak: inBreak, items: list.items.length, boardSeconds: list.boardSeconds, enabled: list.enabled }; },
    };

    var boardSeconds = function () { return Math.max(10, Number(list.boardSeconds) || 60); };

    var load = function () {
      var done = function () {
        window.setTimeout(load, Math.max(30, Number(list.refreshSeconds) || 120) * 1000);
        if (!started) { started = true; startBreak(); } // switched on: the photos first, then the board
      };
      window.fetch(api, { cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) { if (body && body.data && body.data.items) list = body.data; })
        .catch(function () { /* keep the last list */ })
        .then(done, done);
    };

    var waitForBoard = function () {
      window.clearTimeout(boardTimer);
      boardTimer = window.setTimeout(startBreak, boardSeconds() * 1000);
    };

    var rotation = function () {
      var r = Number(document.documentElement.getAttribute("data-tv-rotate"));
      return r === 90 || r === 180 || r === 270 ? r : 0;
    };

    var fill = function (el) {
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.width = "100%";
      el.style.height = "100%";
    };

    /** The photos turned the way the page is; on its side the frame swaps width and height to fill the screen. */
    var turn = function () {
      if (!stage) return;
      var deg = rotation();
      if (deg === 90 || deg === 270) {
        stage.style.cssText = "position:absolute;left:50%;top:50%;width:100vh;height:100vw;transform:translate(-50%,-50%) rotate(" + deg + "deg)";
      } else {
        stage.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%" + (deg ? ";transform:rotate(180deg)" : "");
      }
    };

    var build = function () {
      layer = document.createElement("div");
      layer.setAttribute("data-tv-media", "");
      layer.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;background:#000;overflow:hidden;cursor:none;opacity:0;transition:opacity .6s ease";
      stage = document.createElement("div");
      turn();
      layer.appendChild(stage);
      document.body.appendChild(layer);
      window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { if (layer) layer.style.opacity = "1"; }); });
    };

    var stopVideo = function (slide) {
      var v = slide && slide.querySelector("video");
      if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) { /* gone */ } }
    };

    var put = function (slide) {
      fill(slide);
      slide.style.opacity = "0";
      slide.style.transition = "opacity .6s ease";
      stage.appendChild(slide);
      var before = current;
      current = slide;
      window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { slide.style.opacity = "1"; }); });
      if (before) window.setTimeout(function () { stopVideo(before); if (before.parentNode) before.parentNode.removeChild(before); }, 700);
    };

    var endBreak = function () {
      if (!inBreak) return;
      inBreak = false;
      run++;
      window.clearTimeout(stepTimer);
      var old = layer;
      layer = null;
      stage = null;
      current = null;
      if (old) {
        old.style.opacity = "0";
        window.setTimeout(function () { var v = old.querySelectorAll("video"); for (var i = 0; i < v.length; i++) stopVideo(v[i].parentNode); if (old.parentNode) old.parentNode.removeChild(old); }, 700);
      }
      waitForBoard();
    };

    var show = function (items, i, mine) {
      if (mine !== run) return;
      if (i >= items.length) { endBreak(); return; }
      var item = items[i];
      var moved = false;
      var next = function () {
        if (moved || mine !== run) return;
        moved = true;
        window.clearTimeout(stepTimer);
        show(items, i + 1, mine);
      };
      var after = function (seconds) { window.clearTimeout(stepTimer); stepTimer = window.setTimeout(next, seconds * 1000); };
      var slide = document.createElement("div");
      slide.style.background = "#000";

      if (item.kind === "video") {
        var v = document.createElement("video");
        v.muted = true;
        v.setAttribute("muted", "");
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.preload = "auto";
        fill(v);
        v.style.objectFit = "contain";
        v.onended = next;
        v.onerror = next;
        v.src = item.url;
        slide.appendChild(v);
        put(slide);
        var playing = v.play();
        if (playing && playing.catch) playing.catch(next);
        // Never stuck on a video that stalls: its length and a margin, at most 15 minutes.
        after(Math.min(900, (Number(item.durationSec) > 0 ? Number(item.durationSec) + 15 : 300)));
      } else {
        var img = new window.Image();
        img.onload = function () {
          if (moved || mine !== run) return;
          var blur = document.createElement("div");
          fill(blur);
          blur.style.backgroundImage = "url(\"" + item.url.replace(/"/g, "%22") + "\")";
          blur.style.backgroundSize = "cover";
          blur.style.backgroundPosition = "center";
          blur.style.filter = "blur(32px) brightness(.45)";
          blur.style.transform = "scale(1.15)";
          fill(img);
          img.style.objectFit = "contain";
          slide.appendChild(blur);
          slide.appendChild(img);
          put(slide);
          after(Math.max(3, Number(item.seconds) || 10));
        };
        img.onerror = next;
        after(20); // a photo that never loads is skipped (set first: a cached one can load at once)
        img.src = item.url;
      }
      // The next photo starts loading now, so it's ready when this one is done.
      var following = items[i + 1];
      if (following && following.kind === "image") { var pre = new window.Image(); pre.src = following.url; }
    };

    var startBreak = function () {
      window.clearTimeout(boardTimer);
      if (inBreak) return;
      var items = list.enabled && list.items ? list.items.slice() : [];
      if (!items.length || document.hidden) { waitForBoard(); return; }
      inBreak = true;
      run++;
      build();
      show(items, 0, run);
    };

    // Turned while a photo or video is showing (2026-11-02, the pod board): it turns too, without waiting for the next round.
    if (window.MutationObserver) {
      new window.MutationObserver(turn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tv-rotate"] });
    }

    window.addEventListener("tv:celebrate", function () {
      if (inBreak) endBreak();
      else if (started) waitForBoard();
    });

    load();
  } catch (e) {
    /* the board stays as it was */
  }
})();
