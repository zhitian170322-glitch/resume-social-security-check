import { describe, expect, it } from "vitest";
import {
  REAL_FIXTURE_CALIBRATION_STATUS,
  SocialSecurityPageClassifier,
} from "./social-security-page-classifier";

describe("SocialSecurityPageClassifier", () => {
  const classifier = new SocialSecurityPageClassifier();

  it("keeps the missing real-fixture calibration gate explicit", () => {
    expect(REAL_FIXTURE_CALIBRATION_STATUS).toBe(
      "REAL_FIXTURE_CALIBRATION_PENDING",
    );
  });

  it("routes explicit table headers to Table OCR", () => {
    expect(
      classifier.classify({
        mimeType: "application/pdf",
        text: [
          "单位编号    单位名称    缴费年月",
          "30078648    深圳市友点科技有限公司    2022-08",
          "30078648    深圳市友点科技有限公司    2022-09",
        ].join("\n"),
      }),
    ).toMatchObject({
      pageType: "TABLE",
      reasons: expect.arrayContaining(["TABLE_HEADERS_DETECTED"]),
    });
  });

  it("keeps readable prose on the PDF text path", () => {
    expect(
      classifier.classify({
        mimeType: "application/pdf",
        text: [
          "社会保险参保证明",
          "兹证明相关人员已依法参加社会保险。本证明仅用于办理相关业务。",
          "材料内容完整，具体缴费明细请以社会保险经办机构记录为准。",
        ].join("\n"),
      }),
    ).toMatchObject({ pageType: "PLAIN_TEXT" });
  });

  it("routes pages without a text layer to General OCR preview", () => {
    expect(
      classifier.classify({
        mimeType: "image/png",
        text: null,
      }),
    ).toMatchObject({
      pageType: "SCANNED_UNKNOWN",
      reasons: ["NO_RELIABLE_TEXT_LAYER"],
    });
  });

  it("stops unsupported inputs", () => {
    expect(
      classifier.classify({
        mimeType: "image/svg+xml",
        text: "<svg />",
      }),
    ).toMatchObject({
      pageType: "UNSUPPORTED",
      reasons: ["UNSUPPORTED_MIME_TYPE"],
    });
  });
});
