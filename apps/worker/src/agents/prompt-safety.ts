/**
 * Neutralises tag-like sequences in untrusted text that could close or open
 * the XML-style wrappers prompts use to mark data (`<paper>`, `<evidence>`…).
 * `</paper>` becomes `[/paper]`. Verification must run against the
 * neutralised text — the text the model actually saw — so quotes still match.
 */
export function neutraliseTags(text: string, tags: readonly string[]): string {
  const pattern = new RegExp(`<(\\/?)(${tags.join("|")})\\b([^<>]*)>?`, "gi");
  return text.replace(pattern, "[$1$2$3]");
}
