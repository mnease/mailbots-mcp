/** Clip MCP tool text so Grok Build / Grok Bot do not silently truncate at ~20KB. */
export function clipToolText(text: string, budget: number): string {
  if (!budget || budget < 1 || text.length <= budget) return text;
  const notice = `\n\n[truncated ${text.length - budget} chars; raise MAILBOTS_MCP_MAX_RESULT_BYTES or narrow the query]`;
  const keep = Math.max(0, budget - notice.length);
  return text.slice(0, keep) + notice;
}
