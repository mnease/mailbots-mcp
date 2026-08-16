import { describe, it, expect } from "vitest";
import { clipToolText } from "../../src/security/clip.js";

describe("clipToolText", () => {
  it("leaves short text alone", () => {
    expect(clipToolText("hello", 100)).toBe("hello");
  });

  it("does not clip when budget is 0", () => {
    const long = "x".repeat(500);
    expect(clipToolText(long, 0)).toBe(long);
  });

  it("clips and says how much was dropped", () => {
    const long = "abcdefghij".repeat(20);
    const out = clipToolText(long, 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out).toContain("truncated");
  });
});
