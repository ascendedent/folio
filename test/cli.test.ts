import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { run } from "../src/cli.js";
import { fixturePath } from "./helpers.js";

describe("CLI", () => {
  it("prints beat titles from an FDX file", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const code = run(["beats", fixturePath("kitchen.fdx")]);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }
    assert.match(lines.join("\n"), /\[board\] Opening/);
    assert.match(lines.join("\n"), /\[scene-card\] INT\. KITCHEN - NIGHT/);
    assert.match(lines.join("\n"), /\[character-arc\] MAYA/);
  });

  it("exports formatted text", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "folio-"));
    const out = path.join(directory, "kitchen.txt");
    const code = run(["export", fixturePath("kitchen.fountain"), "--to", "text", "--out", out]);
    assert.equal(code, 0);
    const text = readFileSync(out, "utf8");
    assert.match(text, /INT\. KITCHEN - NIGHT/);
    assert.match(text, /MAYA/);
  });

  it("rejects an unknown command", () => {
    const code = run(["nope"]);
    assert.equal(code, 1);
  });
});
