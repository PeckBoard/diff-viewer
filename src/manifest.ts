// The plugin manifest JSON body — identity, hooks, sidebar/page routes, and the
// permissions the host functions require.

const DESCRIPTION =
  "Diff viewer for Peckboard: a side-by-side viewer/editor for every file that " +
  "differs from the remote main branch (origin/main), including new files and " +
  "images, served as a WASM plugin.";
const VERSION = "0.2.0";
const REPOSITORY = "https://github.com/PeckBoard/diff-viewer";

/// Build the manifest JSON string. `index.ts`'s `manifest()` export wraps this.
export function manifestJson(): string {
  const manifest = {
    description: DESCRIPTION,
    version: VERSION,
    repository: REPOSITORY,

    hooks: ["http.request.before", "http.request.authed"],

    // Full-page entries on the project and session pages. The diff is scoped to
    // that project's / session's folder — opened from the global sidebar there
    // is no folder to diff, so this plugin contributes only the scoped surfaces.
    project_items: [
      { id: "diff-viewer", label: "Diff Viewer", path: "/plugin-api/v1/diff-viewer" },
    ],
    session_items: [
      { id: "diff-viewer", label: "Diff Viewer", path: "/plugin-api/v1/diff-viewer" },
    ],

    http_routes: ["GET /plugin-api/v1/diff-viewer"],

    // Authenticated app-UI endpoints (behind core's require_auth, served under
    // the logged-in user's authority). The page calls these.
    ui_routes: [
      "GET /api/plugin-ui/diff/files",
      "GET /api/plugin-ui/diff/file",
      "POST /api/plugin-ui/diff/save",
    ],

    permissions: [
      "contribute_sidebar",
      "process_exec", // git, in the project folder
      "project_files_read", // read_file / read_file_base64
      "project_files_write", // write_file (the editor's Save)
      "user_authority", // serve authenticated UI endpoints
    ],
  };
  return JSON.stringify(manifest);
}
