import { db } from "./db";
import { fileStorage } from "./file-storage";

export async function cleanupExpiredFiles(now = new Date()) {
  const expired = db
    .prepare("SELECT id, storage_key FROM task_files WHERE expires_at <= ?")
    .all(now.toISOString()) as Array<{ id: string; storage_key: string }>;
  for (const file of expired) {
    try {
      await fileStorage.delete(file.storage_key);
      db.prepare("DELETE FROM task_files WHERE id = ?").run(file.id);
    } catch {
      // Leave the row for the next cleanup pass; never delete metadata before the file.
    }
  }
  return expired.length;
}
