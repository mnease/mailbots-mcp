import { describe, it, expect } from "vitest";
import { threadingFor } from "../../src/providers/compose.js";

describe("compose helpers", () => {
  it("builds In-Reply-To and appends to existing References", () => {
    expect(threadingFor({ rfcMessageId: "<a@x>", references: "<b@x>" })).toEqual({
      inReplyTo: "<a@x>",
      references: "<b@x> <a@x>",
    });
  });
});
