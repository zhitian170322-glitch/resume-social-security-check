import { describe, expect, it } from "vitest";
import {
  adaptAliyunOcrResponse,
  describeOcrEnvelope,
  hasUsableOcrPage,
  mergeOcrPages,
} from "./ocr-adapter";

describe("Aliyun OCR response adapter", () => {
  it("accepts Data as a JSON string and as an object", () => {
    const fromString = adaptAliyunOcrResponse({
      statusCode: 200,
      body: {
        requestId: "req-string",
        data: JSON.stringify({ content: "甲科技有限公司 2020年1月" }),
      },
    });
    const fromObject = adaptAliyunOcrResponse({
      statusCode: 200,
      Body: {
        RequestId: "req-object",
        Data: { content: "乙科技有限公司 2021年6月" },
      },
    });
    expect(fromString).toMatchObject({
      rawText: "甲科技有限公司 2020年1月",
      requestId: "req-string",
    });
    expect(fromObject).toMatchObject({
      rawText: "乙科技有限公司 2021年6月",
      requestId: "req-object",
    });
  });

  it("reads content, wordsInfo and table cells", () => {
    const words = adaptAliyunOcrResponse({
      body: {
        requestId: "words",
        data: { wordsInfo: [{ text: "一行文字" }, { word: "第二行" }] },
      },
    });
    const table = adaptAliyunOcrResponse({
      body: {
        requestId: "table",
        data: {
          prism_tablesInfo: [
            {
              cellInfos: [
                { ysc: 0, xsc: 0, word: "单位名称" },
                { ysc: 0, xsc: 1, word: "甲科技有限公司" },
              ],
            },
          ],
        },
      },
    });
    expect(words.rawText).toBe("一行文字\n第二行");
    expect(table.tables[0]?.cells.map((cell) => cell.text)).toEqual([
      "单位名称",
      "甲科技有限公司",
    ]);
    expect(hasUsableOcrPage(table)).toBe(true);
  });

  it("does not throw on an unknown HTTP 200 shape and only exposes keys", () => {
    const response = {
      statusCode: 200,
      body: { requestId: "unknown-1", payload: { nested: true } },
    };
    const page = adaptAliyunOcrResponse(response);
    const note = describeOcrEnvelope(response);
    expect(hasUsableOcrPage(page)).toBe(false);
    expect(note.requestId).toBe("unknown-1");
    expect(note.topLevelKeys).toEqual(
      expect.arrayContaining(["body", "payload", "requestId", "statusCode"]),
    );
    expect(JSON.stringify(note)).not.toContain("nested");
  });

  it("merges table and general pages when either side is usable", () => {
    const merged = mergeOcrPages(
      [
        {
          page: 1,
          rawText: "",
          tables: [{ cells: [{ row: 0, column: 0, text: "甲科技有限公司" }] }],
          requestId: "table",
        },
        { page: 1, rawText: "甲科技有限公司 2020-01", tables: [], requestId: "general" },
      ],
      1,
    );
    expect(hasUsableOcrPage(merged)).toBe(true);
    expect(merged.rawText).toContain("甲科技有限公司");
    expect(merged.tables).toHaveLength(1);
  });
});
