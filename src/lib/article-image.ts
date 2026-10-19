/** Browser-safe policy for the one source whose RSS article images were verified. */
export function isArticleImageUrl(value: unknown, sourceId: unknown): value is string {
  if (sourceId !== "geekpark" || typeof value !== "string" || !value || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "imgslim.geekpark.net" &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}
