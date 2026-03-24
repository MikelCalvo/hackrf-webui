import fs from "node:fs/promises";
import path from "node:path";

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function stripMarks(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
}

export function compareText(left, right) {
  return collator.compare(left, right);
}

export function slugify(value) {
  return stripMarks(value)
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeKey(value) {
  return stripMarks(value)
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export function ensureUniqueId(baseId, existingIds) {
  let nextId = baseId;
  let suffix = 2;
  while (existingIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return nextId;
}

export async function writeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialized, "utf8");
}

export async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

export function normalizeFreqMhz(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  return Number.parseFloat(numeric.toFixed(3));
}

export function formatFreqKey(value) {
  const numeric = normalizeFreqMhz(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "NaN";
}

export function toTag(value) {
  return slugify(value).replace(/-/g, "-");
}
