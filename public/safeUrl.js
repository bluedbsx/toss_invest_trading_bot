// Codex: external RSS values must not become markup or executable URLs.
export function safeNewsUrl(value) {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}
