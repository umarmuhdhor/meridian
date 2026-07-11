import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let counter = 0;

export async function mkTmpDir(label: string): Promise<string> {
  counter += 1;
  const dir = path.join(os.tmpdir(), `meridian-test-${label}-${process.pid}-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
