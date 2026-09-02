import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePaths = [
  "index.html",
  "about/index.html",
  "business/index.html",
  "cases/index.html",
  "news/index.html",
  "contact/index.html",
];

const extract = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match?.[1], `Missing ${label}`);
  return match[1].trim();
};

test("publishes six noindex core pages with unique metadata", async () => {
  const pages = await Promise.all(pagePaths.map(async (relativePath) => ({
    relativePath,
    source: await readFile(path.join(root, "dist", "client", relativePath), "utf8"),
  })));
  const titles = pages.map(({ source }) => extract(source, /<title>([^<]+)<\/title>/i, "title"));
  const descriptions = pages.map(({ source }) => extract(source, /<meta\s+name="description"\s+content="([^"]+)"/i, "description"));

  assert.equal(new Set(titles).size, pagePaths.length);
  assert.equal(new Set(descriptions).size, pagePaths.length);
  for (const { relativePath, source } of pages) {
    assert.match(source, /<meta\s+name="robots"\s+content="noindex,nofollow,noarchive"/i, `${relativePath} must remain noindex`);
  }
});

test("every static content image has meaningful alt text", async () => {
  const contentPages = pagePaths.slice(1);
  for (const relativePath of contentPages) {
    const source = await readFile(path.join(root, "dist", "client", relativePath), "utf8");
    const images = source.match(/<img\b[^>]*>/gi) ?? [];
    assert.ok(images.length > 0, `${relativePath} should contain at least one image`);
    for (const image of images) {
      assert.match(image, /\balt="[^"]+"/i, `${relativePath} has an image without meaningful alt text`);
    }
  }
});

test("all core pages expose a consultation route", async () => {
  const appSource = await readFile(path.join(root, "src", "App.tsx"), "utf8");
  assert.match(appSource, /href="#consultation"/);

  for (const relativePath of pagePaths.slice(1)) {
    const source = await readFile(path.join(root, "dist", "client", relativePath), "utf8");
    assert.match(source, /href="\/#consultation"|href="mailto:/i, `${relativePath} lacks a consultation route`);
  }
});
