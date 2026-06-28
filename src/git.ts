// Git-backed diff computation: the changed-file list (working tree vs
// origin/main) and per-file old/new content. Host calls are kept lazy so the
// pure parsing helpers (parseNameStatus / normalizeStatus / isImagePath /
// looksBinary) import cleanly under vitest.

import { gitExec, readFile, readFileBase64, listProjectFiles, ProjectFile, ExecResult } from "./host";

/// The remote main branch we diff against. Used as-is (no fetch): we compare
/// the working tree against whatever origin/main is already fetched locally.
export const BASE = "origin/main";

// ── Repo discovery + scoping ──────────────────────────────────────────
//
// The caller's folder may itself be a git repo, or may *contain* several repos
// as subfolders (a multi-repo workspace). Every git/file operation is scoped to
// one repo by its `prefix`: the repo root's path relative to the folder root
// ("" means the folder root itself). git runs there via `-C <prefix>`, and
// file reads/writes prepend the prefix onto the repo-relative path.

/// A git repo found within the caller's folder.
export interface RepoInfo {
  prefix: string; // repo root relative to the folder ("" = folder root)
  label: string; // display label
}

// Bounds for the discovery BFS so a deep/large folder can't spawn unbounded git
// probes. Repos are typically the folder root or a direct child, so these are
// generous.
const MAX_REPO_PROBES = 256;
const MAX_REPO_DEPTH = 6;

/// Validate & normalize a client-supplied repo prefix. "" = folder root.
/// Rejects absolute paths and any "." / ".." segment so it can never escape the
/// folder when handed to `git -C` or joined onto a file path.
export function cleanPrefix(prefix: string | undefined): string {
  const p = (prefix || "").trim();
  if (p === "") return "";
  if (p.startsWith("/") || p.startsWith("\\")) {
    throw new Error("repo must be a relative path within the folder");
  }
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new Error("repo path must not contain '..'");
    out.push(seg);
  }
  return out.join("/");
}

/// Prepend `-C <prefix>` so git runs in the repo subfolder (no-op for root).
export function gitArgs(prefix: string, args: string[]): string[] {
  return prefix ? (["-C", prefix] as string[]).concat(args) : args.slice();
}

/// Join a repo-relative path onto the repo prefix to get a folder-relative path
/// for the file host calls.
export function joinRepoPath(prefix: string, path: string): string {
  return prefix ? prefix + "/" + path : path;
}

/// A display label for a repo prefix.
export function repoLabel(prefix: string): string {
  return prefix === "" ? "(project root)" : prefix;
}

/// Collect the directories (relative; "" = root) that contain files, from a
/// `peckboard_list_project_files` listing — every ancestor dir of every file,
/// deduped. These are the candidate repo roots discovery walks over.
export function collectDirs(files: { path: string }[]): Set<string> {
  const dirs = new Set<string>([""]);
  for (const f of files) {
    const parts = f.path.split("/");
    parts.pop(); // drop the file name
    let acc = "";
    for (const part of parts) {
      acc = acc ? acc + "/" + part : part;
      dirs.add(acc);
    }
  }
  return dirs;
}

/// Immediate child directories of `dir` present in `dirs`.
export function childDirs(dir: string, dirs: Set<string>): string[] {
  const base = dir === "" ? "" : dir + "/";
  const out: string[] = [];
  dirs.forEach((d) => {
    if (d === "" || d.indexOf(base) !== 0) return;
    const rest = d.slice(base.length);
    if (rest === "" || rest.indexOf("/") >= 0) return; // not an immediate child
    out.push(d);
  });
  return out;
}

/// Whether `prefix` is the *root* of a git work tree. At a work-tree root
/// `rev-parse --show-cdup` exits 0 with empty output; in a subdir it returns a
/// `../` path, and outside any repo it errors.
function isRepoRoot(prefix: string): boolean {
  const r = gitExec(gitArgs(prefix, ["rev-parse", "--show-cdup"]));
  return r.exit_code === 0 && r.stdout.trim() === "";
}

/// Discover git repo roots within the caller's folder. BFS from the folder
/// root, flagging each directory that is a work-tree root and NOT descending
/// into a found repo (its interior belongs to it). Bounded by probe/depth caps.
export function discoverRepos(): RepoInfo[] {
  let dirs: Set<string>;
  try {
    const listing = listProjectFiles();
    dirs = collectDirs(listing.files || []);
  } catch (_e) {
    dirs = new Set<string>([""]);
  }
  const repos: RepoInfo[] = [];
  const queue: string[] = [""];
  let probes = 0;
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    if (probes >= MAX_REPO_PROBES) break;
    probes++;
    if (isRepoRoot(dir)) {
      repos.push({ prefix: dir, label: repoLabel(dir) });
      continue; // prune: the repo's interior isn't a separate repo
    }
    const depth = dir === "" ? 0 : dir.split("/").length;
    if (depth >= MAX_REPO_DEPTH) continue;
    for (const c of childDirs(dir, dirs)) queue.push(c);
  }
  repos.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  return repos;
}

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

/// Whether origin/main resolves locally in the given repo. If not, there is
/// nothing to diff against and the caller surfaces a helpful message.
export function baseExists(prefix: string): boolean {
  const r = gitExec(gitArgs(prefix, ["rev-parse", "--verify", "--quiet", BASE + "^{commit}"]));
  return r.exit_code === 0;
}

/// The full changed-file list for one repo: tracked changes from `git diff`
/// plus untracked new files from `git ls-files --others`.
export function changedFiles(prefix: string): ChangedFile[] {
  const diff = gitExec(gitArgs(prefix, ["diff", "--name-status", "-M", "--no-color", BASE, "--"]));
  if (diff.exit_code !== 0) {
    throw new Error(gitError("git diff", diff));
  }
  const files = parseNameStatus(diff.stdout);

  // Untracked files aren't part of `git diff origin/main`; list them as added.
  const seen: Record<string, boolean> = {};
  for (const f of files) seen[f.path] = true;
  const others = gitExec(gitArgs(prefix, ["ls-files", "--others", "--exclude-standard"]));
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

/// Whether `path` exists in the repo's origin/main tree.
function existsInBase(prefix: string, path: string): boolean {
  const r = gitExec(gitArgs(prefix, ["cat-file", "-e", BASE + ":" + path]));
  return r.exit_code === 0;
}

/// The origin/main version of `path` as text (for the diff's left side).
function baseText(prefix: string, path: string): { text: string; truncated: boolean } {
  const r = gitExec(gitArgs(prefix, ["show", BASE + ":" + path]));
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

/// Resolve both sides of one changed file in `prefix`'s repo. `path`/`oldPath`
/// are relative to that repo's root; `oldPath` is the origin/main path for a
/// rename (defaults to `path`).
export function fileView(prefix: string, path: string, oldPathArg?: string): FileView {
  const oldPath = oldPathArg && oldPathArg.length > 0 ? oldPathArg : path;
  const image = isImagePath(path);

  const oldPresent = existsInBase(prefix, oldPath);
  // The working-tree file is present unless it was deleted.
  let newPresent = true;
  let newText: string | undefined;
  let newBase64: string | undefined;
  let newTruncated = false;
  let newNote: string | undefined;

  if (image) {
    // Read the working-tree image as raw bytes for a data-URL preview.
    try {
      const b = readFileBase64(joinRepoPath(prefix, path));
      newBase64 = b.base64;
      newTruncated = b.truncated;
    } catch (_e) {
      newPresent = false; // deleted / unreadable
    }
  } else {
    try {
      const r = readFile(joinRepoPath(prefix, path));
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
        const b = baseText(prefix, oldPath);
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
