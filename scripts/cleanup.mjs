import Database from "better-sqlite3";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const dbPath = resolve((process.env.DATABASE_URL || "file:./data/app.db").replace(/^file:/, ""));
const root = resolve(process.env.UPLOAD_DIR || "./data/uploads");
const db = new Database(dbPath);
const expired = db
  .prepare("SELECT id, storage_key FROM task_files WHERE expires_at <= ?")
  .all(new Date().toISOString());
for (const file of expired) {
  const path = resolve(root, file.storage_key);
  if (path.startsWith(`${root}${sep}`)) {
    await rm(path, { force: true });
    db.prepare("DELETE FROM task_files WHERE id = ?").run(file.id);
  }
}
db.close();
console.log(`Removed ${expired.length} expired raw files`);
