import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { config } from "./config";

export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root = config.UPLOAD_DIR) {
    this.root = resolve(root);
  }

  private safePath(key: string) {
    const target = resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new Error("Path traversal rejected");
    }
    return target;
  }

  async save(key: string, data: Buffer) {
    const target = this.safePath(key);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, data, { mode: 0o600 });
  }

  read(key: string) {
    return readFile(this.safePath(key));
  }

  async delete(key: string) {
    await rm(this.safePath(key), { force: true });
  }
}

export const fileStorage: FileStorage = new LocalFileStorage();
