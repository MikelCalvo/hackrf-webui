import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { AudioCaptureModule } from "@/lib/types";

const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const CAPTURES_DIR = path.join(DATA_DIR, "captures");

function ensureDir(dirPath: string): string {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function capturesRootDir(): string {
  return ensureDir(CAPTURES_DIR);
}

export function ensureCaptureSessionDir(module: AudioCaptureModule, sessionId: string, now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return ensureDir(path.join(capturesRootDir(), year, month, day, module, sessionId));
}

export function capturePrefixForSession(module: AudioCaptureModule, sessionId: string, now = new Date()): string {
  return path.join(ensureCaptureSessionDir(module, sessionId, now), "activity");
}

export function captureRelativePath(absolutePath: string): string | null {
  const root = capturesRootDir();
  const relative = path.relative(root, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative.split(path.sep).join("/");
}

export function captureAbsolutePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }

  const absolutePath = path.join(capturesRootDir(), normalized);
  const relative = path.relative(capturesRootDir(), absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}

export function capturePathExists(relativePath: string): boolean {
  const absolutePath = captureAbsolutePath(relativePath);
  return absolutePath ? existsSync(absolutePath) : false;
}
