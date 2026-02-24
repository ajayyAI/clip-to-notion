const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../src/shared-core.js");

test("normalizePostUrl canonicalizes valid x.com and twitter.com URLs", () => {
  assert.equal(
    core.normalizePostUrl("https://x.com/naval/status/1938273648273648?t=abc"),
    "https://x.com/naval/status/1938273648273648"
  );
  assert.equal(
    core.normalizePostUrl("https://twitter.com/naval/status/1938273648273648"),
    "https://x.com/naval/status/1938273648273648"
  );
  assert.equal(core.normalizePostUrl("/naval/status/1938273648273648"), "https://x.com/naval/status/1938273648273648");
});

test("normalizePostUrl rejects invalid status URLs", () => {
  assert.equal(core.normalizePostUrl("https://x.com/home"), null);
  assert.equal(core.normalizePostUrl("https://example.com/naval/status/1"), null);
  assert.equal(core.normalizePostUrl("not-a-url"), null);
});

test("normalizeDatabaseId accepts raw IDs and notion URLs", () => {
  assert.equal(
    core.normalizeDatabaseId("12345678123412341234123456789abc"),
    "12345678-1234-1234-1234-123456789abc"
  );
  assert.equal(
    core.normalizeDatabaseId("12345678-1234-1234-1234-123456789abc"),
    "12345678-1234-1234-1234-123456789abc"
  );
  assert.equal(
    core.normalizeDatabaseId("https://www.notion.so/workspace/Ideas-12345678123412341234123456789abc"),
    "12345678-1234-1234-1234-123456789abc"
  );
});

test("buildTitle falls back to handle when post has no text", () => {
  assert.equal(core.buildTitle("   ", "naval"), "X post by @naval");
  assert.equal(core.buildTitle("", ""), "Saved X post");
});

test("buildAuthorLabel combines name and handle", () => {
  assert.equal(core.buildAuthorLabel("naval", "Naval"), "Naval (@naval)");
  assert.equal(core.buildAuthorLabel("naval", ""), "@naval");
});

test("normalizeISODate returns null for invalid date values", () => {
  assert.equal(core.normalizeISODate("invalid"), null);
  assert.match(core.normalizeISODate("2025-11-20T10:00:00Z"), /^2025-11-20T10:00:00\.000Z$/);
});
