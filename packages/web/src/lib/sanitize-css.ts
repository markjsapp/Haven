/**
 * Sanitize user-provided custom CSS to prevent data exfiltration and code execution.
 *
 * Strips:
 * - @import rules (can load external stylesheets)
 * - @charset rules (encoding attacks)
 * - url() values (can phone home / exfiltrate via background-image, list-style, etc.)
 * - expression() / -moz-binding (legacy JS execution in CSS)
 * - javascript: URIs
 * - behavior: property (IE HTC execution)
 * - -moz-binding property (XBL execution)
 */
export function sanitizeCss(raw: string): string {
  let css = raw;

  // Remove @import rules (with or without url(), handles multiline)
  css = css.replace(/@import\s+[^;]*;/gi, "/* @import removed */");

  // Remove @charset rules
  css = css.replace(/@charset\s+[^;]*;/gi, "/* @charset removed */");

  // Remove url() values — replace with empty string to preserve the property
  // Handles: url("..."), url('...'), url(...)
  css = css.replace(/url\s*\(\s*(['"]?).*?\1\s*\)/gi, "none");

  // Remove expression() (IE CSS expressions)
  css = css.replace(/expression\s*\([^)]*\)/gi, "none");

  // Remove -moz-binding (XBL binding, Firefox)
  css = css.replace(/-moz-binding\s*:\s*[^;}"']*/gi, "/* -moz-binding removed */");

  // Remove behavior: (IE HTC)
  css = css.replace(/behavior\s*:\s*[^;}"']*/gi, "/* behavior removed */");

  // Remove javascript: URIs that might sneak through
  css = css.replace(/javascript\s*:/gi, "/* blocked */");

  return css;
}
