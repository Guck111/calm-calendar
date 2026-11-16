// Google stores the description either as text or as simple HTML: show it as text
export const plainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    // only tags: «a < b > c» is text, not a tag
    .replace(/<\/?[a-z][^<>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // last: «&amp;lt;» is the text «&lt;», not «<»
    .replace(/&amp;/g, "&")
    .trim();
