// Git-backed diff computation: the changed-file list (working tree vs
// origin/main) and per-file old/new content. Host calls are kept lazy so the
// pure parsing helpers (parseNameStatus / normalizeStatus / isImagePath /
// looksBinary) import cleanly under vitest.

import { gitExec, readFile, readFileBase64, ExecResult } from "./host";

/// The remote main branch we diff against. Used as-is (no fetch): we compare
/// the working tree against whatever origin/main is already fetched locally.
export const BASE = "origin/main";

/// One changed path between origin/main and the working tree.
export interface ChangedFile {
  path: string; // current (working-tree) path
  status: string; // "added" | "modified" | "deleted" | "renamed"
  oldPath?: string; // origin/main path, when different (renames)
}

/// Image extensions we render inline via a data URL (read as base64).
const IMAGE_EXTS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
];

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot < 0 || dot < slash) return "";
  return path.slice(dot + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.indexOf(ext(path)) >= 0;
}

export function mimeForPath(path: string): string {
  return MIME_BY_EXT[ext(path)] || "application/octet-stream";
}

/// Heuristic: a NUL byte (after lossy decode it survives as U+0000) means the
/// content is binary and not worth showing as text.
export function looksBinary(content: string): boolean {
  return content.indexOf("\u0000") >= 0;
}

/// Map a porcelain `--name-status` code to our coarse status label.
export function normalizeStatus(code: string): string {
  const c = (code || "").charAt(0).toUpperCase();
  if (c === "A") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "C") return "renamed"; // copy — treat like a rename for display
  return "modified"; // M, T (typechange), U, …
}

/// Parse `git diff --name-status -M` output into ChangedFile rows. Each line is
/// TAB-separated: `A\tpath`, `M\tpath`, `D\tpath`, or `R100\told\tnew`.
export function parseNameStatus(stdout: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    const code = parts[0] || "";
    const status = normalizeStatus(code);
    if ((status === "renamed") && parts.length >= 3) {
      out.push({ path: parts[2], status, oldPath: parts[1] });
    } else if (parts.length >= 2) {
      out.push({ path: parts[1], status });
    }
  }
  return out;
}

// ── host-backed operations ────────────────────────────────────────────

/// Whether origin/main resolves locally. If not, there is nothing to diff
/// against and the caller surfaces a helpful message.
export function baseExists(): boolean {
  const r = gitExec(["rev-parse", "--verify", "--quiet", BASE + "^{commit}"]);
  return r.exit_code === 0;
}

/// The full changed-file list: tracked changes from `git diff` plus untracked
/// new files from `git ls-files --others`.
export function changedFiles(): ChangedFile[] {
  const diff = gitExec(["diff", "--name-status", "-M", "--no-color", BASE, "--"]);
  if (diff.exit_code !== 0) {
    throw new Error(gitError("git diff", diff));
  }
  const files = parseNameStatus(diff.stdout);

  // Untracked files aren't part of `git diff origin/main`; list them as added.
  const seen: Record<string, boolean> = {};
  for (const f of files) seen[f.path] = true;
  const others = gitExec(["ls-files", "--others", "--exclude-standard"]);
  if (others.exit_code === 0) {
    for (const raw of others.stdout.split("\n")) {
      const p = raw.replace(/\r$/, "");
      if (p.trim() === "" || seen[p]) continue;
      seen[p] = true;
      files.push({ path: p, status: "added" });
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

/// Whether `path` exists in the origin/main tree.
function existsInBase(path: string): boolean {
  const r = gitExec(["cat-file", "-e", BASE + ":" + path]);
  return r.exit_code === 0;
}

/// The origin/main version of `path` as text (for the diff's left side).
function baseText(path: string): { text: string; truncated: boolean } {
  const r = gitExec(["show", BASE + ":" + path]);
  if (r.exit_code !== 0) {
    throw new Error(gitError("git show", r));
  }
  return { text: r.stdout, truncated: r.stdout_truncated };
}

/// One side of a file (left = origin/main, right = working tree).
export interface Side {
  present: boolean;
  text?: string;
  base64?: string; // image data (working-tree side only)
  truncated?: boolean;
  note?: string; // when content can't be shown (binary / unavailable)
}

/// A file's two sides plus its display kind, for the viewer/diff/editor.
export interface FileView {
  path: string;
  oldPath: string;
  status: string;
  kind: "text" | "image" | "binary";
  mime: string;
  editable: boolean;
  old: Side;
  new: Side;
}

/// Resolve both sides of one changed file. `oldPath` is the origin/main path
/// for a rename (defaults to `path`).
export function fileView(path: string, oldPathArg?: string): FileView {
  const oldPath = oldPathArg && oldPathArg.length > 0 ? oldPathArg : path;
  const image = isImagePath(path);

  const oldPresent = existsInBase(oldPath);
  // The working-tree file is present unless it was deleted.
  let newPresent = true;
  let newText: string | undefined;
  let newBase64: string | undefined;
  let newTruncated = false;
  let newNote: string | undefined;

  if (image) {
    // Read the working-tree image as raw bytes for a data-URL preview.
    try {
      const b = readFileBase64(path);
      newBase64 = b.base64;
      newTruncated = b.truncated;
    } catch (_e) {
      newPresent = false; // deleted / unreadable
    }
  } else {
    try {
      const r = readFile(path);
      if (looksBinary(r.content)) {
        newNote = "Binary file — preview unavailable.";
        return binaryView(path, oldPath, statusFrom(oldPresent, true));
      }
      newText = r.content;
      newTruncated = r.truncated;
    } catch (_e) {
      newPresent = false; // deleted / unreadable
    }
  }

  const status = statusFrom(oldPresent, newPresent, oldPath !== path);

  // Left side (origin/main).
  const old: Side = { present: oldPresent };
  if (oldPresent) {
    if (image) {
      // Git stores the old image as a binary blob we can't extract cleanly
      // through the text host calls — show the new version, note the old.
      old.note = "Previous version is binary; inline preview is unavailable.";
    } else {
      try {
        const b = baseText(oldPath);
        if (looksBinary(b.text)) {
          return binaryView(path, oldPath, status);
        }
        old.text = b.text;
        old.truncated = b.truncated;
      } catch (_e) {
        old.note = "Could not read the origin/main version.";
      }
    }
  }

  const right: Side = { present: newPresent };
  if (newPresent) {
    if (newText !== undefined) right.text = newText;
    if (newBase64 !== undefined) right.base64 = newBase64;
    if (newTruncated) right.truncated = true;
    if (newNote) right.note = newNote;
  }

  return {
    path,
    oldPath,
    status,
    kind: image ? "image" : "text",
    mime: image ? mimeForPath(path) : "text/plain",
    // Only plain-text working-tree files are editable in place.
    editable: !image && newPresent,
    old,
    new: right,
  };
}

function statusFrom(oldPresent: boolean, newPresent: boolean, renamed?: boolean): string {
  if (renamed) return "renamed";
  if (!oldPresent && newPresent) return "added";
  if (oldPresent && !newPresent) return "deleted";
  return "modified";
}

function binaryView(path: string, oldPath: string, status: string): FileView {
  return {
    path,
    oldPath,
    status,
    kind: "binary",
    mime: "application/octet-stream",
    editable: false,
    old: { present: oldPath !== path || status !== "added", note: "Binary file." },
    new: { present: status !== "deleted", note: "Binary file — preview unavailable." },
  };
}

/// Compose a readable error from a failed git invocation.
function gitError(label: string, r: ExecResult): string {
  const msg = (r.stderr || r.stdout || "").trim();
  if (r.timed_out) return `${label} timed out`;
  return `${label} failed${msg ? ": " + msg : ` (exit ${r.exit_code})`}`;
}
