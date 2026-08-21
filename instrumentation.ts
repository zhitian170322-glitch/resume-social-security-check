export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupExpiredFiles } = await import("./src/lib/cleanup");
    const { kickWorker } = await import("./src/lib/worker");
    await cleanupExpiredFiles();
    kickWorker();
    const timer = setInterval(() => void cleanupExpiredFiles(), 24 * 60 * 60 * 1000);
    timer.unref();
  }
}
