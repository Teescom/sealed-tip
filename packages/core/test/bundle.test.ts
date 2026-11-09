// The bundle envelope is what the panel opens, so its schema is the contract between two browsers that
// never talk to each other (S-10.4). These tests name the rules, not the fields.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BundleReport, TipBundle } from "../src/index.js";

const file = (name: string, mime: string, data = "aGVsbG8="): Record<string, unknown> => ({ name, mime, data });

const bundle = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  title: "Road contract fraud — Fictional State",
  description: "The invoice was paid twice for the same stretch of road.",
  files: [file("invoice.pdf", "application/pdf")],
  report: { files: [{ name: "invoice.pdf", type: "application/pdf", pages: 2, removed: ["Author"], scanMode: false }], warnings: [] },
  redaction: null,
  ...overrides,
});

test("a cleaned PDF, JPEG and PNG are all allowed in one bundle", () => {
  const parsed = TipBundle.safeParse(
    bundle({
      files: [
        file("invoice.pdf", "application/pdf"),
        file("photo.jpeg", "image/jpeg"),
        file("scan.png", "image/png"),
      ],
    }),
  );
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("a document type nothing cleans is refused at the envelope too", () => {
  // The gate is the first refusal; this is the second, for a bundle assembled by something that skipped it.
  for (const mime of ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]) {
    assert.equal(
      TipBundle.safeParse(bundle({ files: [file("memo.docx", mime)] })).success,
      false,
      `${mime} must not be describable as cleaned evidence`,
    );
  }
});

test("a bundle of nothing but words is a tip, and an empty description is not", () => {
  assert.equal(TipBundle.safeParse(bundle({ files: [] })).success, true);
  assert.equal(TipBundle.safeParse(bundle({ description: "" })).success, false);
  assert.equal(TipBundle.safeParse(bundle({ title: "" })).success, false);
});

test("the raw originals have one place to live, and it is optional", () => {
  assert.equal(TipBundle.safeParse(bundle()).success, true, "a normal tip carries no raw files at all");
  const opted = bundle({ raw_files: [file("invoice.pdf", "application/pdf", "dGVzdA==")] });
  assert.equal(TipBundle.safeParse(opted).success, true);
  // A raw file is still only a file the cleaners can produce: the opt-in is about cleaning, not about types.
  assert.equal(TipBundle.safeParse(bundle({ raw_files: [file("memo.docx", "text/html")] })).success, false);
});

test("a file whose bytes are not base64 is refused before anything is encrypted", () => {
  const parsed = TipBundle.safeParse(bundle({ files: [file("invoice.pdf", "application/pdf", "two spaces here")] }));
  assert.equal(parsed.success, false);
});

test("a bundle cannot be used to smuggle an arbitrary report shape", () => {
  assert.equal(BundleReport.safeParse({ files: [], warnings: [] }).success, true);
  assert.equal(BundleReport.safeParse({ files: [{ name: "a.pdf" }], warnings: [] }).success, false);
  assert.equal(BundleReport.safeParse({ files: [], warnings: [1] }).success, false);
});

test("the description cap is a byte limit a tipster can be told about", () => {
  assert.equal(TipBundle.safeParse(bundle({ description: "x".repeat(200_000) })).success, true);
  assert.equal(TipBundle.safeParse(bundle({ description: "x".repeat(200_001) })).success, false);
});

test("an unknown extra field is not silently accepted as part of the exhibit", () => {
  // zod strips by default; the point of this test is that the shape below still parses, so a writer that
  // adds a field cannot break a reader — and that the reader never sees the field it does not know.
  const parsed = TipBundle.safeParse(bundle({ contact_email: "someone@example.org" }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && "contact_email" in parsed.data, false);
});
