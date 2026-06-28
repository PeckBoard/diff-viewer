// FFI layer: the Peckboard core host functions this plugin calls, and the
// host_call marshaling helper. All host calls are kept LAZY (inside functions)
// so the pure modules that import these helpers load under vitest without an
// Extism runtime.

type HostFn = (offset: bigint) => bigint;

/// Call a host function and parse its JSON response, surfacing an
/// `{"error": ...}` envelope (or a trap) as a thrown Error.
export function hostCall(name: string, input: unknown): any {
  const f = (Host.getFunctions() as Record<string, HostFn>)[name];
  const mem = Memory.fromString(JSON.stringify(input));
  const out = f(mem.offset);
  const parsed = JSON.parse(Memory.find(out).readString());
  if (parsed && parsed.error !== undefined && parsed.error !== null) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

/// Result of an allowlisted command run in the project folder.
export interface ExecResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  timed_out: boolean;
}

/// Run `git <args>` in the caller's project folder (read-only use here).
export function gitExec(args: string[], timeoutSecs?: number): ExecResult {
  const input: Record<string, unknown> = { command: "git", args };
  if (typeof timeoutSecs === "number") {
    input.timeout_secs = timeoutSecs;
  }
  return hostCall("peckboard_exec", input) as ExecResult;
}

/// Read a UTF-8 text file (lossy) from the project folder.
export function readFile(path: string): { content: string; truncated: boolean; size: number } {
  return hostCall("peckboard_read_file", { path });
}

/// Read raw file bytes, base64-encoded — used for binary content (images).
export function readFileBase64(path: string): { base64: string; truncated: boolean; size: number } {
  return hostCall("peckboard_read_file_base64", { path });
}

/// Overwrite a file in the project folder with new text (the editor's Save).
export function writeFile(path: string, content: string): any {
  return hostCall("peckboard_write_file", {
    path,
    content,
    append: false,
    create_dirs: true,
  });
}
