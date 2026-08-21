import { describe, expect, it } from "vitest";
import { validateUpload } from "./upload";

function pdfFile(size: number, name = "resume.pdf") {
  const content = Buffer.alloc(size);
  content.write("%PDF-1.7\n");
  return new File([content], name, { type: "application/pdf" });
}

describe("upload security", () => {
  it("accepts the exact 20MB boundary", async () => {
    await expect(validateUpload(pdfFile(20 * 1024 * 1024), "RESUME")).resolves.toMatchObject({
      mime: "application/pdf",
      extension: ".pdf",
    });
  });

  it("rejects a file over 20MB", async () => {
    await expect(validateUpload(pdfFile(20 * 1024 * 1024 + 1), "RESUME")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("rejects executable content disguised as a PDF", async () => {
    const malicious = new File([Buffer.from("MZ executable payload")], "resume.pdf");
    await expect(validateUpload(malicious, "RESUME")).rejects.toMatchObject({
      code: "INVALID_FILE_TYPE",
    });
  });

  it("rejects forbidden extensions", async () => {
    const script = new File([Buffer.from("<script>alert(1)</script>")], "resume.html");
    await expect(validateUpload(script, "SOCIAL_SECURITY")).rejects.toMatchObject({
      code: "INVALID_FILE_TYPE",
    });
  });
});
