# Peckboard Diff Viewer

A Peckboard WASM plugin (Extism js-pdk / TypeScript) that shows every file in the
current project that **differs from the remote main branch** (`origin/main`) and
gives you a full-featured viewer/editor for each one:

- **Changed-file list** in a sidebar, grouped by status (modified / added /
  renamed / deleted).
- **Side-by-side diff** with line numbers and add/delete/modify highlighting,
  computed client-side with an LCS line diff.
- **New files** render with the full new content on the right and an empty left
  side; **deleted files** show the origin/main content on the left.
- **Image files** (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif`,
  `svg`) render inline in the working-tree column via a `data:` URL.
- **In-place editor**: edit any plain-text working-tree file and **Save** writes
  it straight back to disk.

The plugin adds a **Diff Viewer** item to the Peckboard sidebar.

## How it works

| Concern | Mechanism |
| --- | --- |
| Diff base | Local `origin/main` ref, used as-is (no fetch). If it isn't present the UI explains how to fetch it. |
| Changed files | `git diff --name-status -M origin/main` plus `git ls-files --others --exclude-standard` for untracked new files. |
| File contents | `git show origin/main:<path>` for the old side; `peckboard_read_file` (text) / `peckboard_read_file_base64` (images) for the working-tree side. |
| Editing | `peckboard_write_file` overwrites the working-tree file. |
| UI | A self-contained HTML page served at `GET /plugin-api/v1/diff-viewer`, sandboxed in an iframe, talking to authed JSON endpoints under `/api/plugin-ui/diff/*` via the parent-proxied fetch bridge. |

All git/file access is pinned by Peckboard core to the caller's project folder.

### Endpoints

- `GET /plugin-api/v1/diff-viewer` — the page (unauthenticated shell).
- `GET /api/plugin-ui/diff/files` — changed-file list.
- `GET /api/plugin-ui/diff/file?path=<p>&old_path=<p>` — one file's two sides.
- `POST /api/plugin-ui/diff/save` — `{ path, content }`, saves the edit.

### Permissions

`contribute_sidebar`, `process_exec` (git), `project_files_read`,
`project_files_write`, `user_authority`.

### Requirements

- Peckboard core providing the `peckboard_read_file_base64` host function (added
  alongside this plugin) for image rendering.

> **Note on old image versions:** the working-tree image renders fully. The
> *previous* (origin/main) version of a changed image is a git blob that can't be
> extracted intact through the text host calls, so the left column shows a note
> rather than the old image.

## Build

```bash
./build.sh          # installs deps on first run, outputs dist/plugin.wasm
# or
npm install
npm run build
```

## Test

```bash
npm test            # vitest — pure parsing/diff helpers
```

## Publishing

`dist/plugin.wasm` is the artifact. Publish it as a GitHub release asset, then
add this entry to the Peckboard plugin registry (`plugins/registry.json`).
Recompute the `sha256` after any rebuild with `sha256sum dist/plugin.wasm`:

```json
{
  "id": "diff-viewer",
  "name": "Diff Viewer",
  "description": "Side-by-side viewer/editor for every file that differs from origin/main, including new files and images, served as a WASM plugin.",
  "author": "PeckBoard",
  "homepage": "https://github.com/PeckBoard/diff-viewer",
  "version": "0.1.0",
  "hooks": ["http.request.before", "http.request.authed"],
  "url": "https://github.com/PeckBoard/diff-viewer/releases/download/v0.1.0/diff-viewer.wasm",
  "sha256": "756fd677a62acedee8a1332aea6f548d875f25515febf319831a486cb28be5a1",
  "min_peckboard": "0.0.19"
}
```
