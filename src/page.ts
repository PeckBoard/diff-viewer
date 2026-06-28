// The self-contained Diff Viewer page served at /plugin-api/v1/diff-viewer.
// Runs sandboxed in an iframe (no same-origin), so it reaches the authed API
// only through the parent-proxied fetch bridge (window.postMessage). The inner
// script deliberately uses string concatenation (no template literals / "${"),
// so this whole file can be an outer template literal without interpolation.

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Diff Viewer</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --fg: #1f2328;
    --muted: #57606a;
    --border: #d0d7de;
    --bg: #ffffff;
    --bg-subtle: #f6f8fa;
    --accent: #0969da;
    --danger: #cf222e;
    --add-bg: #e6ffec;
    --add-gutter: #ccffd8;
    --del-bg: #ffebe9;
    --del-gutter: #ffd7d5;
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    color: var(--fg);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .6rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    flex: 0 0 auto;
  }
  header h1 { font-size: 1.05rem; margin: 0; }
  header .base { font-size: .8rem; color: var(--muted); }
  header .spacer { flex: 1; }
  .repo-label {
    display: flex;
    align-items: center;
    gap: .35rem;
    font-size: .78rem;
    color: var(--muted);
  }
  .repo-select {
    font: inherit;
    font-size: .82rem;
    padding: .2rem .4rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    max-width: 22rem;
  }
  .picker { padding: 2rem 1rem; }
  .picker h2 { font-size: 1rem; margin: 0 0 .25rem; }
  .picker p.sub { color: var(--muted); margin: 0 0 1rem; font-size: .85rem; }
  .repo-card {
    display: flex;
    align-items: center;
    gap: .6rem;
    width: 100%;
    text-align: left;
    padding: .6rem .75rem;
    margin: 0 0 .5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
    cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .9rem;
  }
  .repo-card:hover { background: #ddf4ff; border-color: #b6e3ff; }
  .repo-card .repo-ico { flex: 0 0 auto; }
  .layout { flex: 1 1 auto; display: flex; min-height: 0; }
  .sidebar {
    width: 320px;
    flex: 0 0 320px;
    border-right: 1px solid var(--border);
    overflow: auto;
    padding: .5rem;
  }
  .main { flex: 1 1 auto; overflow: auto; min-width: 0; display: flex; flex-direction: column; }
  .group-h {
    font-size: .72rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--muted);
    margin: .75rem .25rem .25rem;
    display: flex;
    align-items: center;
    gap: .4rem;
  }
  .count {
    font-size: .72rem;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 .45rem;
    color: var(--muted);
  }
  .file {
    display: flex;
    align-items: center;
    gap: .5rem;
    padding: .3rem .45rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: .85rem;
    word-break: break-all;
  }
  .file:hover { background: var(--bg-subtle); }
  .file.active { background: #ddf4ff; }
  .stat {
    flex: 0 0 auto;
    width: 1.1rem;
    text-align: center;
    font-weight: 700;
    font-size: .8rem;
  }
  .stat.added { color: #1a7f37; }
  .stat.deleted { color: var(--danger); }
  .stat.modified { color: #9a6700; }
  .stat.renamed { color: var(--accent); }
  .badge {
    font-size: .72rem;
    font-weight: 600;
    padding: .1rem .5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--muted);
  }
  .badge.added { background: #dafbe1; color: #1a7f37; border-color: #aceebb; }
  .badge.deleted { background: #ffebe9; color: var(--danger); border-color: #ffcecb; }
  .badge.modified { background: #fff8c5; color: #7d4e00; border-color: #f0e08a; }
  .badge.renamed { background: #ddf4ff; color: #0a5cad; border-color: #b6e3ff; }
  .toolbar {
    display: flex;
    align-items: center;
    gap: .6rem;
    padding: .5rem 1rem;
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; word-break: break-all; }
  .oldpath { color: var(--muted); font-size: .78rem; }
  button {
    font: inherit;
    font-weight: 500;
    padding: .3rem .75rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--fg);
    cursor: pointer;
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.active { background: #ddf4ff; border-color: #b6e3ff; }
  button:disabled { opacity: .55; cursor: default; }
  .content { flex: 1 1 auto; overflow: auto; }
  .empty { color: var(--muted); font-style: italic; padding: 2rem; text-align: center; }
  .note {
    color: var(--muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: .5rem .6rem;
    margin: 1rem;
    font-size: .85rem;
  }
  .error {
    color: var(--danger);
    background: #ffebe9;
    border: 1px solid #ffcecb;
    border-radius: 6px;
    padding: .5rem .6rem;
    margin: 1rem;
    font-size: .85rem;
    white-space: pre-wrap;
  }
  .banner {
    background: #fff8c5;
    border-bottom: 1px solid #f0e08a;
    color: #7d4e00;
    padding: .5rem 1rem;
    font-size: .85rem;
  }
  table.diff {
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    table-layout: fixed;
  }
  table.diff td { vertical-align: top; padding: 0 .5rem; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
  td.gutter {
    width: 3.2rem;
    text-align: right;
    color: var(--muted);
    background: var(--bg-subtle);
    border-right: 1px solid var(--border);
    user-select: none;
  }
  td.code { width: calc(50% - 3.2rem); }
  td.sep { width: 1px; padding: 0; background: var(--border); }
  tr.add td.code.right, tr.add td.gutter.right { background: var(--add-bg); }
  tr.add td.gutter.right { background: var(--add-gutter); }
  tr.del td.code.left, tr.del td.gutter.left { background: var(--del-bg); }
  tr.del td.gutter.left { background: var(--del-gutter); }
  tr.mod td.code.left { background: var(--del-bg); }
  tr.mod td.code.right { background: var(--add-bg); }
  tr.mod td.gutter.left { background: var(--del-gutter); }
  tr.mod td.gutter.right { background: var(--add-gutter); }
  .imgwrap { display: flex; gap: 1.5rem; padding: 1rem; flex-wrap: wrap; }
  .imgcol { flex: 1 1 280px; min-width: 240px; }
  .imgcol h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 .5rem; }
  .imgcol img {
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  }
  .editor {
    width: 100%;
    height: 100%;
    min-height: 60vh;
    border: 0;
    padding: .5rem 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    resize: none;
    outline: none;
  }
  .trunc { font-size: .78rem; color: var(--danger); padding: .25rem 1rem; }
</style>
</head>
<body>
<header>
  <h1>Diff Viewer</h1>
  <label class="repo-label" id="repoLabel" hidden>Repo
    <select class="repo-select" id="repoSelect"></select>
  </label>
  <span class="base" id="base"></span>
  <span class="spacer"></span>
  <button id="reload">Reload</button>
</header>
<div class="layout">
  <div class="sidebar" id="sidebar"><p class="empty">Loading…</p></div>
  <div class="main" id="main"><p class="empty">Select a file to view its changes.</p></div>
</div>
<script>
(function () {
  "use strict";

  // ── Parent-proxied fetch bridge (sandboxed iframe, no same-origin). ──
  var _pending = {};
  var _seq = 0;
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (m && m.type === "plugin-ui-fetch-result" && _pending[m.requestId]) {
      _pending[m.requestId]({ status: m.status, body: m.body });
      delete _pending[m.requestId];
    }
  });
  function apiFetch(path, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var requestId = ++_seq;
      _pending[requestId] = resolve;
      window.parent.postMessage(
        { type: "plugin-ui-fetch", requestId: requestId, method: opts.method || "GET", path: path, body: opts.body },
        "*"
      );
    });
  }

  // ── tiny DOM helpers (textContent only; never innerHTML with data) ──
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var sidebar = document.getElementById("sidebar");
  var main = document.getElementById("main");
  var baseEl = document.getElementById("base");
  var repoSelect = document.getElementById("repoSelect");
  var repoLabel = document.getElementById("repoLabel");

  var state = { repos: [], repo: null, files: [], base: "origin/main", active: null, mode: "diff" };

  // Append the active repo to a query string (so every data call is scoped).
  function withRepo(q) {
    if (state.repo == null) return q;
    return q + (q.indexOf("?") >= 0 ? "&" : "?") + "repo=" + encodeURIComponent(state.repo);
  }

  function statusChar(s) {
    if (s === "added") return "A";
    if (s === "deleted") return "D";
    if (s === "renamed") return "R";
    return "M";
  }

  // ── sidebar: changed-file list grouped by status ──
  function renderSidebar() {
    clear(sidebar);
    if (state.files.length === 0) {
      sidebar.appendChild(el("p", "empty", "No files differ from " + state.base + "."));
      return;
    }
    var order = ["modified", "added", "renamed", "deleted"];
    var labels = { modified: "Modified", added: "Added", renamed: "Renamed", deleted: "Deleted" };
    var groups = {};
    state.files.forEach(function (f) {
      (groups[f.status] = groups[f.status] || []).push(f);
    });
    order.forEach(function (st) {
      var list = groups[st];
      if (!list || !list.length) return;
      var h = el("div", "group-h", labels[st]);
      h.appendChild(el("span", "count", String(list.length)));
      sidebar.appendChild(h);
      list.forEach(function (f) { sidebar.appendChild(fileRow(f)); });
    });
  }

  function fileRow(f) {
    var row = el("div", "file");
    if (state.active && state.active.path === f.path) row.className += " active";
    row.appendChild(el("span", "stat " + f.status, statusChar(f.status)));
    var name = el("span", null, f.path);
    row.appendChild(name);
    row.addEventListener("click", function () { selectFile(f); });
    return row;
  }

  // ── load + render one file ──
  function selectFile(f) {
    state.active = f;
    state.mode = "diff";
    renderSidebar();
    clear(main);
    main.appendChild(el("p", "empty", "Loading " + f.path + "…"));
    var q = "/api/plugin-ui/diff/file?path=" + encodeURIComponent(f.path);
    if (f.oldPath) q += "&old_path=" + encodeURIComponent(f.oldPath);
    apiFetch(withRepo(q)).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        showMainError(res.body || ("HTTP " + res.status));
        return;
      }
      var data;
      try { data = JSON.parse(res.body); }
      catch (e) { showMainError("Failed to parse response: " + e); return; }
      state.view = data;
      renderFile();
    });
  }

  function showMainError(msg) {
    clear(main);
    main.appendChild(el("div", "error", msg));
  }

  function renderFile() {
    var v = state.view;
    clear(main);

    // toolbar
    var tb = el("div", "toolbar");
    var badge = el("span", "badge " + v.status, v.status);
    tb.appendChild(badge);
    var pathBox = el("div");
    if (v.oldPath && v.oldPath !== v.path) {
      pathBox.appendChild(el("div", "oldpath", v.oldPath + "  \\u2192"));
    }
    pathBox.appendChild(el("div", "path", v.path));
    tb.appendChild(pathBox);
    tb.appendChild(el("span", null, "")).style.flex = "1";

    if (v.kind === "text") {
      var diffBtn = el("button", state.mode === "diff" ? "active" : null, "Side-by-side");
      var editBtn = el("button", state.mode === "edit" ? "active" : null, v.editable ? "Edit" : "Full file");
      diffBtn.addEventListener("click", function () { state.mode = "diff"; renderFile(); });
      editBtn.addEventListener("click", function () { state.mode = "edit"; renderFile(); });
      tb.appendChild(diffBtn);
      tb.appendChild(editBtn);
      if (state.mode === "edit" && v.editable) {
        var saveBtn = el("button", "primary", "Save");
        saveBtn.id = "saveBtn";
        saveBtn.addEventListener("click", saveEdit);
        tb.appendChild(saveBtn);
      }
    }
    main.appendChild(tb);

    var content = el("div", "content");
    content.id = "content";
    main.appendChild(content);

    if (v.kind === "image") { renderImage(content, v); return; }
    if (v.kind === "binary") {
      content.appendChild(el("div", "note", (v.new && v.new.note) || "Binary file — preview unavailable."));
      return;
    }
    // text
    if (state.mode === "edit" && v.editable) { renderEditor(content, v); }
    else { renderDiff(content, v); }
  }

  // ── image view ──
  function renderImage(content, v) {
    var wrap = el("div", "imgwrap");
    var oldCol = el("div", "imgcol");
    oldCol.appendChild(el("h3", null, "origin/main"));
    if (v.old && v.old.present) {
      oldCol.appendChild(el("div", "note", v.old.note || "Previous version unavailable."));
    } else {
      oldCol.appendChild(el("div", "note", "Not present in origin/main."));
    }
    var newCol = el("div", "imgcol");
    newCol.appendChild(el("h3", null, "working tree"));
    if (v.new && v.new.base64) {
      var img = el("img");
      img.src = "data:" + v.mime + ";base64," + v.new.base64;
      img.alt = v.path;
      newCol.appendChild(img);
      if (v.new.truncated) newCol.appendChild(el("div", "trunc", "Image truncated at the read limit."));
    } else {
      newCol.appendChild(el("div", "note", "Not present in the working tree (deleted)."));
    }
    wrap.appendChild(oldCol);
    wrap.appendChild(newCol);
    content.appendChild(wrap);
  }

  // ── editor ──
  function renderEditor(content, v) {
    var ta = el("textarea", "editor");
    ta.id = "editor";
    ta.value = (v.new && v.new.text) || "";
    ta.spellcheck = false;
    content.appendChild(ta);
  }

  function saveEdit() {
    var v = state.view;
    var ta = document.getElementById("editor");
    var btn = document.getElementById("saveBtn");
    if (!ta || !btn) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    apiFetch("/api/plugin-ui/diff/save", {
      method: "POST",
      body: JSON.stringify({ repo: state.repo == null ? "" : state.repo, path: v.path, content: ta.value }),
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Save";
      if (res.status < 200 || res.status >= 300) {
        var c = document.getElementById("content");
        if (c) { var e2 = el("div", "error", res.body || ("HTTP " + res.status)); c.insertBefore(e2, c.firstChild); }
        return;
      }
      // Re-fetch so the diff reflects the saved content.
      state.view.new.text = ta.value;
      btn.textContent = "Saved";
      setTimeout(function () { if (btn) btn.textContent = "Save"; }, 1200);
    });
  }

  // ── side-by-side diff ──
  function renderDiff(content, v) {
    var oldText = (v.old && v.old.present && v.old.text != null) ? v.old.text : "";
    var newText = (v.new && v.new.present && v.new.text != null) ? v.new.text : "";
    var rows = sideBySide(splitLines(oldText), splitLines(newText));

    if (v.old && v.old.truncated) content.appendChild(el("div", "trunc", "origin/main side truncated at the read limit."));
    if (v.new && v.new.truncated) content.appendChild(el("div", "trunc", "working-tree side truncated at the read limit."));

    var table = el("table", "diff");
    var tbody = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr", r.cls);
      tr.appendChild(gutter("gutter left", r.ln));
      tr.appendChild(code("code left", r.left));
      tr.appendChild(el("td", "sep"));
      tr.appendChild(gutter("gutter right", r.rn));
      tr.appendChild(code("code right", r.right));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  }

  function gutter(cls, n) { return el("td", cls, n != null ? String(n) : ""); }
  function code(cls, text) { return el("td", cls, text != null ? text : ""); }

  function splitLines(s) {
    if (s === "") return [];
    var lines = s.split("\\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  // Build aligned side-by-side rows from old/new line arrays via an LCS diff.
  function sideBySide(a, b) {
    var ops = diffOps(a, b);
    var rows = [];
    var la = 0, lb = 0;
    var i = 0;
    while (i < ops.length) {
      var op = ops[i];
      if (op.tag === "equal") {
        la++; lb++;
        rows.push({ cls: "", ln: la, rn: lb, left: op.a, right: op.b });
        i++;
      } else {
        // Gather a run of deletes followed by inserts and pair them up.
        var dels = [], inss = [];
        while (i < ops.length && ops[i].tag === "delete") { dels.push(ops[i]); i++; }
        while (i < ops.length && ops[i].tag === "insert") { inss.push(ops[i]); i++; }
        var k = Math.max(dels.length, inss.length);
        for (var j = 0; j < k; j++) {
          var d = dels[j], n = inss[j];
          if (d && n) {
            la++; lb++;
            rows.push({ cls: "mod", ln: la, rn: lb, left: d.a, right: n.b });
          } else if (d) {
            la++;
            rows.push({ cls: "del", ln: la, rn: null, left: d.a, right: null });
          } else if (n) {
            lb++;
            rows.push({ cls: "add", ln: null, rn: lb, left: null, right: n.b });
          }
        }
      }
    }
    return rows;
  }

  // Produce equal/delete/insert opcodes via LCS, with a size guard so a huge
  // file falls back to a cheap line-by-line alignment instead of O(n*m) work.
  function diffOps(a, b) {
    var n = a.length, m = b.length;
    if (n === 0 && m === 0) return [];
    if (n * m > 4000000) return fallbackOps(a, b);

    // LCS length table (rolling not needed for a viewer; clarity over memory).
    var dp = [];
    for (var x = 0; x <= n; x++) dp.push(new Int32Array(m + 1));
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    var p = 0, q = 0;
    while (p < n && q < m) {
      if (a[p] === b[q]) { ops.push({ tag: "equal", a: a[p], b: b[q] }); p++; q++; }
      else if (dp[p + 1][q] >= dp[p][q + 1]) { ops.push({ tag: "delete", a: a[p] }); p++; }
      else { ops.push({ tag: "insert", b: b[q] }); q++; }
    }
    while (p < n) { ops.push({ tag: "delete", a: a[p] }); p++; }
    while (q < m) { ops.push({ tag: "insert", b: b[q] }); q++; }
    return ops;
  }

  function fallbackOps(a, b) {
    var ops = [];
    var k = Math.min(a.length, b.length);
    for (var i = 0; i < k; i++) {
      if (a[i] === b[i]) ops.push({ tag: "equal", a: a[i], b: b[i] });
      else { ops.push({ tag: "delete", a: a[i] }); ops.push({ tag: "insert", b: b[i] }); }
    }
    for (var d = k; d < a.length; d++) ops.push({ tag: "delete", a: a[d] });
    for (var n2 = k; n2 < b.length; n2++) ops.push({ tag: "insert", b: b[n2] });
    return ops;
  }

  // ── repo discovery + selection ──
  function loadRepos() {
    clear(sidebar);
    sidebar.appendChild(el("p", "empty", "Loading…"));
    clear(main);
    main.appendChild(el("p", "empty", "Discovering git repositories…"));
    apiFetch("/api/plugin-ui/diff/repos").then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        clear(sidebar);
        showMainError(res.body || ("HTTP " + res.status));
        return;
      }
      var data;
      try { data = JSON.parse(res.body); }
      catch (e) { showMainError("Parse error: " + e); return; }
      state.repos = Array.isArray(data.repos) ? data.repos : [];
      renderRepoSelect();
      if (state.repos.length === 0) {
        clear(sidebar);
        clear(main);
        main.appendChild(el("div", "banner",
          "No git repositories found in this folder. The Diff Viewer works on a " +
          "folder that is a git repo, or that contains repos as subfolders."));
      } else if (state.repos.length === 1) {
        selectRepo(state.repos[0].prefix);
      } else {
        renderRepoPicker();
      }
    });
  }

  // Populate the header repo dropdown (shown only when ≥1 repo is found).
  function renderRepoSelect() {
    clear(repoSelect);
    if (state.repos.length === 0) { repoLabel.hidden = true; return; }
    repoLabel.hidden = false;
    state.repos.forEach(function (r) {
      var opt = el("option", null, r.label || r.prefix || "(project root)");
      opt.value = r.prefix;
      repoSelect.appendChild(opt);
    });
    if (state.repo != null) repoSelect.value = state.repo;
  }

  // A landing picker when several repos are in scope and none is chosen yet.
  function renderRepoPicker() {
    clear(sidebar);
    sidebar.appendChild(el("p", "empty", "Pick a repository to begin."));
    clear(main);
    var box = el("div", "picker");
    box.appendChild(el("h2", null, "Select a repository"));
    box.appendChild(el("p", "sub", state.repos.length + " git repositories found in this folder."));
    state.repos.forEach(function (r) {
      var card = el("button", "repo-card");
      card.appendChild(el("span", "repo-ico", "\\uD83D\\uDCC1"));
      card.appendChild(el("span", null, r.label || r.prefix || "(project root)"));
      card.addEventListener("click", function () { selectRepo(r.prefix); });
      box.appendChild(card);
    });
    main.appendChild(box);
  }

  function selectRepo(prefix) {
    state.repo = prefix;
    state.active = null;
    state.view = null;
    if (repoSelect) repoSelect.value = prefix;
    loadFiles();
  }

  // ── load the changed-file list for the active repo ──
  function loadFiles() {
    clear(sidebar);
    sidebar.appendChild(el("p", "empty", "Loading…"));
    clear(main);
    main.appendChild(el("p", "empty", "Select a file to view its changes."));
    apiFetch(withRepo("/api/plugin-ui/diff/files")).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        clear(sidebar);
        sidebar.appendChild(el("div", "error", res.body || ("HTTP " + res.status)));
        return;
      }
      var data;
      try { data = JSON.parse(res.body); }
      catch (e) { clear(sidebar); sidebar.appendChild(el("div", "error", "Parse error: " + e)); return; }
      state.base = data.base || "origin/main";
      state.files = Array.isArray(data.files) ? data.files : [];
      baseEl.textContent = "vs " + state.base;
      renderSidebar();
      if (data.base_available === false && data.message) {
        clear(main);
        main.appendChild(el("div", "banner", data.message));
      }
    });
  }

  // Reload: re-discover repos but keep the current selection if it still exists.
  function reload() {
    var keep = state.repo;
    apiFetch("/api/plugin-ui/diff/repos").then(function (res) {
      if (res.status < 200 || res.status >= 300) { loadRepos(); return; }
      var data;
      try { data = JSON.parse(res.body); } catch (e) { loadRepos(); return; }
      state.repos = Array.isArray(data.repos) ? data.repos : [];
      renderRepoSelect();
      var stillThere = keep != null && state.repos.some(function (r) { return r.prefix === keep; });
      if (stillThere) { selectRepo(keep); }
      else { state.repo = null; loadRepos(); }
    });
  }

  repoSelect.addEventListener("change", function () { selectRepo(repoSelect.value); });
  document.getElementById("reload").addEventListener("click", reload);
  loadRepos();
})();
</script>
</body>
</html>`;
