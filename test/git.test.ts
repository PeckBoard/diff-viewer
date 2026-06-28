import { describe, it, expect } from "vitest";
import {
  parseNameStatus,
  normalizeStatus,
  isImagePath,
  mimeForPath,
  looksBinary,
  cleanPrefix,
  gitArgs,
  joinRepoPath,
  repoLabel,
  collectDirs,
  childDirs,
} from "../src/git";
import { queryParam } from "../src/http";

describe("normalizeStatus", () => {
  it("maps porcelain codes to coarse labels", () => {
    expect(normalizeStatus("A")).toBe("added");
    expect(normalizeStatus("M")).toBe("modified");
    expect(normalizeStatus("D")).toBe("deleted");
    expect(normalizeStatus("R100")).toBe("renamed");
    expect(normalizeStatus("C75")).toBe("renamed");
    expect(normalizeStatus("T")).toBe("modified");
    expect(normalizeStatus("")).toBe("modified");
  });
});

describe("parseNameStatus", () => {
  it("parses add/modify/delete rows", () => {
    const out = parseNameStatus("A\tsrc/new.ts\nM\tsrc/edit.ts\nD\tsrc/gone.ts\n");
    expect(out).toEqual([
      { path: "src/new.ts", status: "added" },
      { path: "src/edit.ts", status: "modified" },
      { path: "src/gone.ts", status: "deleted" },
    ]);
  });

  it("parses a rename with old and new paths", () => {
    const out = parseNameStatus("R096\tsrc/old.ts\tsrc/new.ts\n");
    expect(out).toEqual([{ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" }]);
  });

  it("ignores blank lines and trailing CR", () => {
    const out = parseNameStatus("\r\nM\ta.txt\r\n\n");
    expect(out).toEqual([{ path: "a.txt", status: "modified" }]);
  });
});

describe("isImagePath / mimeForPath", () => {
  it("detects image extensions case-insensitively", () => {
    expect(isImagePath("ui/logo.PNG")).toBe(true);
    expect(isImagePath("a/b.svg")).toBe(true);
    expect(isImagePath("src/main.ts")).toBe(false);
    expect(isImagePath("Makefile")).toBe(false);
    expect(isImagePath("dir.png/file")).toBe(false);
  });
  it("maps extensions to mime types", () => {
    expect(mimeForPath("a.png")).toBe("image/png");
    expect(mimeForPath("a.jpg")).toBe("image/jpeg");
    expect(mimeForPath("a.svg")).toBe("image/svg+xml");
    expect(mimeForPath("a.bin")).toBe("application/octet-stream");
  });
});

describe("looksBinary", () => {
  it("flags content containing a NUL byte", () => {
    expect(looksBinary("hello\u0000world")).toBe(true);
    expect(looksBinary("plain text\n")).toBe(false);
  });
});

describe("cleanPrefix", () => {
  it("treats empty/blank as the folder root", () => {
    expect(cleanPrefix(undefined)).toBe("");
    expect(cleanPrefix("")).toBe("");
    expect(cleanPrefix("   ")).toBe("");
  });
  it("normalizes a clean relative path", () => {
    expect(cleanPrefix("peckboard")).toBe("peckboard");
    expect(cleanPrefix("a/b/c")).toBe("a/b/c");
    expect(cleanPrefix("a/./b/")).toBe("a/b");
    expect(cleanPrefix("a\\b")).toBe("a/b");
  });
  it("rejects escapes", () => {
    expect(() => cleanPrefix("/etc")).toThrow();
    expect(() => cleanPrefix("..")).toThrow();
    expect(() => cleanPrefix("a/../../b")).toThrow();
  });
});

describe("gitArgs / joinRepoPath / repoLabel", () => {
  it("prepends -C only for a non-root prefix", () => {
    expect(gitArgs("", ["status"])).toEqual(["status"]);
    expect(gitArgs("sub", ["status"])).toEqual(["-C", "sub", "status"]);
  });
  it("joins a repo-relative path onto the prefix", () => {
    expect(joinRepoPath("", "src/a.ts")).toBe("src/a.ts");
    expect(joinRepoPath("sub", "src/a.ts")).toBe("sub/src/a.ts");
  });
  it("labels the root specially", () => {
    expect(repoLabel("")).toBe("(project root)");
    expect(repoLabel("apps/web")).toBe("apps/web");
  });
});

describe("collectDirs / childDirs", () => {
  it("collects every ancestor directory plus the root", () => {
    const dirs = collectDirs([{ path: "a/b/x.ts" }, { path: "a/y.ts" }, { path: "z.ts" }]);
    expect(dirs).toEqual(new Set(["", "a", "a/b"]));
  });
  it("returns only immediate children", () => {
    const dirs = new Set(["", "a", "a/b", "a/b/c", "d"]);
    expect(childDirs("", dirs).sort()).toEqual(["a", "d"]);
    expect(childDirs("a", dirs)).toEqual(["a/b"]);
    expect(childDirs("a/b", dirs)).toEqual(["a/b/c"]);
  });
});

describe("queryParam", () => {
  it("extracts and url-decodes values", () => {
    expect(queryParam("path=src%2Fa.ts&old_path=src%2Fb.ts", "path")).toBe("src/a.ts");
    expect(queryParam("path=src%2Fa.ts&old_path=src%2Fb.ts", "old_path")).toBe("src/b.ts");
    expect(queryParam("path=a+b.txt", "path")).toBe("a b.txt");
    expect(queryParam("path=x", "missing")).toBeUndefined();
  });
});
