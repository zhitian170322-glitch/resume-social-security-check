import { describe, expect, it } from "vitest";
import {
  companyFromMappedName,
  isUnitCode,
  normalizeCompanyName,
  stripRegionLabelPrefix,
} from "./company-cleanup";

describe("company name pollution cleanup", () => {
  it("strips independent region labels with a colon", () => {
    expect(stripRegionLabelPrefix("东莞市：深圳软通动力信息技术有限公司")).toBe(
      "深圳软通动力信息技术有限公司",
    );
    expect(stripRegionLabelPrefix("深圳市：某某科技有限公司")).toBe(
      "某某科技有限公司",
    );
    expect(stripRegionLabelPrefix("广东省：示例公司")).toBe("示例公司");
  });

  it("keeps 深圳市 inside a legal company name without a standalone colon label", () => {
    expect(stripRegionLabelPrefix("深圳市软通动力信息技术有限公司")).toBe(
      "深圳市软通动力信息技术有限公司",
    );
    expect(normalizeCompanyName("深圳市  软通动力信息技术有限公司")).toBe(
      "深圳市 软通动力信息技术有限公司",
    );
  });

  it("does not treat a unit code as a company name", () => {
    expect(isUnitCode("470855")).toBe(true);
    expect(companyFromMappedName("470855").companyRaw).toBeNull();
  });
});
