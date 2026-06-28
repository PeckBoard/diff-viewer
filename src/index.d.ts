// Wasm interface for the Extism js-pdk compiler (`extism-js`). This declares the
// plugin's exported functions and the host functions Peckboard core provides.
//
// Host functions are JSON-string-in / JSON-string-out at the application level;
// at the ABI they pass a single Extism memory offset (I64) in and return one
// out. See peckboard/src/plugin/host.rs for the host side.
declare module "main" {
  export function manifest(): I32;
  export function init(): I32;
  export function shutdown(): I32;
  export function handle(): I32;
}

declare module "extism:host" {
  interface user {
    peckboard_exec(ptr: I64): I64;
    peckboard_list_project_files(ptr: I64): I64;
    peckboard_read_file(ptr: I64): I64;
    peckboard_read_file_base64(ptr: I64): I64;
    peckboard_write_file(ptr: I64): I64;
  }
}
