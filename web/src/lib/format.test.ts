import { describe, it, expect } from "vitest";
import { formatSize, formatDateTime, relativeTime } from "./format";

describe("formatSize", () => {
  it("字节单位换算", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(300 * 1024 * 1024)).toBe("300 MB");
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("formatDateTime", () => {
  it("ISO 与空格分隔格式都能解析", () => {
    expect(formatDateTime("2026-07-21T09:05:00")).toBe("2026-07-21 09:05");
    expect(formatDateTime("2026-07-21 09:05:00")).toBe("2026-07-21 09:05");
    expect(formatDateTime("")).toBe("");
  });
});

describe("relativeTime", () => {
  it("相对时间描述", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000).toISOString())).toBe("刚刚");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(relativeTime(new Date(now - 3 * 3600_000).toISOString())).toBe("3 小时前");
    expect(relativeTime(new Date(now - 10 * 86400_000).toISOString())).toBe("10 天前");
  });
});
