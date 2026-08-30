import { describe, expect, it } from "vitest";
import { buildPaidMonthDetails, monthDetailsText } from "./month-details";

describe("paid month details", () => {
  it("lists each unique month with unit code, company, type and source", () => {
    const details = buildPaidMonthDetails([
      {
        companyRaw: "深圳软通动力信息技术有限公司",
        unitCode: "470855",
        startMonth: "2025-01",
        endMonth: "2025-02",
        paidMonths: ["2025-01", "2025-02"],
        paymentType: "company",
        sourceFile: "social.pdf",
        sourcePage: 2,
      },
    ]);
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({
      month: "2025-01",
      unitCode: "470855",
      companyRaw: "深圳软通动力信息技术有限公司",
      paymentType: "company",
      sourceFile: "social.pdf",
      sourcePage: 2,
      origin: "system",
    });
    expect(monthDetailsText(details)).toContain("2025-01");
    expect(monthDetailsText(details)).toContain("公司缴纳");
    expect(monthDetailsText(details)).toContain("系统识别");
  });
});
