const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { zipSync, strToU8 } = require("fflate"),
  F = require("../file-rules.js");
for (const [extension, entry] of Object.entries({
  xlsx: "xl/workbook.xml",
  docx: "word/document.xml",
  pptx: "ppt/presentation.xml",
}))
  test(`accept ${extension}, reject extension spoofing`, () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      [entry]: strToU8("<root/>"),
    });
    assert.equal(F.validate(`name.${extension}`, bytes).extension, extension);
    assert.throws(() => F.validate(`name.${extension}`, strToU8("not office")));
  });
test("PDF, binary formats, dangerous formats, limits and malformed zip", () => {
  assert.equal(
    F.validate("report.pdf", strToU8("%PDF-1.4\n")).mime,
    "application/pdf",
  );
  assert.throws(() => F.validate("report.pdf", strToU8("not PDF")));
  assert.throws(() => F.validate("script.html", strToU8("<script/>")));
  assert.throws(() => F.validate("report.txt", strToU8("hello"), 2));
  assert.throws(() => F.validate("report.txt", new Uint8Array([0])));
  assert.throws(() =>
    F.validate("report.docx", new Uint8Array([80, 75, 3, 4])),
  );
});
test("server and browser share the exact validator", () => {
  const fs = require("node:fs"),
    path = require("node:path");
  assert.equal(
    fs.readFileSync(path.join(__dirname, "../file-rules.js"), "utf8"),
    fs.readFileSync(
      path.join(
        __dirname,
        "../supabase/functions/planner-upload/file-rules.js",
      ),
      "utf8",
    ),
  );
});
test("XLSB, WebP and safe ZIP are supported with configurable allow list", () => {
  const workbook = zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.bin": new Uint8Array([1, 2, 3]),
  });
  assert.equal(F.validate("binary.xlsb", workbook).extension, "xlsb");
  assert.equal(
    F.validate("image.webp", strToU8("RIFFxxxxWEBPVP8 ")).mime,
    "image/webp",
  );
  const zip = zipSync({ "report.pdf": strToU8("%PDF-1.4") });
  assert.equal(F.validate("archive.zip", zip).mime, "application/zip");
  assert.throws(() => F.validate("archive.zip", zip, 100000, ["pdf"]));
});
test("archives reject executable payloads, traversal and VBA macros", () => {
  for (const name of ["script.exe", "../report.pdf", "folder/script.ps1"])
    assert.throws(() =>
      F.validate("archive.zip", zipSync({ [name]: strToU8("data") })),
    );
  assert.throws(() =>
    F.validate(
      "report.xlsb",
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.bin": strToU8("data"),
        "xl/vbaProject.bin": strToU8("macro"),
      }),
    ),
  );
});
