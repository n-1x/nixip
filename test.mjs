import test from "node:test"
import { strict as assert } from "node:assert"

import { getFileName } from "./nip.mjs"

test("getFileName: gets windows file name", t => {
   assert.strictEqual(getFileName("C:\\some\\test\\path\\afile.txt"), "afile.txt");
});

test("getFileName: gets linux file name", t => {
   assert.strictEqual(getFileName("/home/nix/nip/afile.txt"), "afile.txt");
});

test("getFileName: gets plain file name", t => {
   assert.strictEqual(getFileName("afile.txt"), "afile.txt");
});