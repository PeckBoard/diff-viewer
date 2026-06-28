// HTTP surfaces: the served Diff Viewer page (`http.request.before`) and the
// authenticated app-UI endpoints (`http.request.authed`, served under the
// logged-in user's authority) the page calls for data and edits.

import { htmlResponse, jsonResponse } from "./verdict";
import { baseExists, changedFiles, fileView, BASE } from "./git";
import { writeFile } from "./host";
import { PAGE } from "./page";
import { errMsg } from "./lib";

const PAGE_PATH = "/plugin-api/v1/diff-viewer";

/// Serve the Diff Viewer page (the sidebar item opens this).
export function serveHttp(payload: any): string {
  const method = (payload && typeof payload.method === "string" ? payload.method : "").toUpperCase();
  const path = payload && typeof payload.path === "string" ? payload.path : "";
  if (method === "GET" && path === PAGE_PATH) {
    return htmlResponse(200, PAGE);
  }
  return htmlResponse(404, "<!doctype html><title>Not found</title><p>Not found.</p>");
}

// ── Authenticated app-UI endpoints (/api/plugin-ui/diff/*) ────────────

export function serveAuthed(payload: any): string {
  const method = (payload && typeof payload.method === "string" ? payload.method : "").toUpperCase();
  const path = payload && typeof payload.path === "string" ? payload.path : "";
  const query = payload && typeof payload.query === "string" ? payload.query : "";
  const body = payload && typeof payload.body === "string" ? payload.body : "";

  try {
    if (method === "GET" && path === "/api/plugin-ui/diff/files") {
      return jsonResponse(200, listFiles());
    }
    if (method === "GET" && path === "/api/plugin-ui/diff/file") {
      return jsonResponse(200, getFile(query));
    }
    if (method === "POST" && path === "/api/plugin-ui/diff/save") {
      return jsonResponse(200, saveFile(body));
    }
  } catch (e) {
    return jsonResponse(400, { error: errMsg(e) });
  }
  return jsonResponse(404, { error: "not found" });
}

/// The changed-file list, or a clear message when origin/main isn't available.
function listFiles(): any {
  if (!baseExists()) {
    return {
      base: BASE,
      base_available: false,
      files: [],
      message:
        "No local '" + BASE + "' ref to diff against. Add a remote named 'origin' " +
        "with a 'main' branch and fetch it (git fetch origin), then reload.",
    };
  }
  return { base: BASE, base_available: true, files: changedFiles() };
}

/// One file's two sides for the viewer/diff/editor.
function getFile(query: string): any {
  const path = queryParam(query, "path");
  if (path === undefined || path.trim() === "") {
    throw new Error("path is required");
  }
  const oldPath = queryParam(query, "old_path");
  return fileView(path, oldPath);
}

/// Save edited text back to the working-tree file.
function saveFile(body: string): any {
  let b: any;
  try {
    b = JSON.parse(body);
  } catch (e) {
    throw new Error("invalid request body: " + errMsg(e));
  }
  const path = typeof b?.path === "string" ? b.path : "";
  if (path.trim() === "") {
    throw new Error("path is required");
  }
  if (typeof b?.content !== "string") {
    throw new Error("content (string) is required");
  }
  writeFile(path, b.content);
  return { ok: true, path };
}

/// Extract and URL-decode `name`'s value from a `&`-separated query string.
export function queryParam(query: string, name: string): string | undefined {
  for (const pair of query.split("&")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx);
    if (k !== name) continue;
    const v = pair.slice(idx + 1);
    try {
      return decodeURIComponent(v.replace(/\+/g, "%20"));
    } catch (_e) {
      return v;
    }
  }
  return undefined;
}
