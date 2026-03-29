import "server-only";

import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT_DIR = path.resolve(SERVER_DIR, "..", "..");

export function projectRootDir(): string {
  return PROJECT_ROOT_DIR;
}

export function projectPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT_DIR, ...segments);
}

export function projectRuntimePath(...segments: string[]): string {
  return path.join(PROJECT_ROOT_DIR, "runtime", ...segments);
}

export function projectBinPath(name: string): string {
  return path.join(PROJECT_ROOT_DIR, "bin", name);
}

export function projectScriptPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT_DIR, "scripts", ...segments);
}

export function projectAssetPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT_DIR, "assets", ...segments);
}
