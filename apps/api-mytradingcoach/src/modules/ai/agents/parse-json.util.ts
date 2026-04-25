/**
 * Strips optional markdown code fences from Anthropic responses and parses JSON.
 * Falls back to a second pass that escapes literal control characters inside strings.
 */
export function parseAnthropicJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch { /* falls through to sanitizer pass */ }

  let inString = false;
  let escaped = false;
  let sanitized = '';
  for (const char of stripped) {
    if (escaped) { sanitized += char; escaped = false; continue; }
    if (char === '\\' && inString) { sanitized += char; escaped = true; continue; }
    if (char === '"') { inString = !inString; sanitized += char; continue; }
    if (inString && char === '\n') { sanitized += '\\n'; continue; }
    if (inString && char === '\r') { sanitized += '\\r'; continue; }
    if (inString && char === '\t') { sanitized += '\\t'; continue; }
    sanitized += char;
  }
  return JSON.parse(sanitized);
}
