/** Words from the last path segment of a link ("…/zuercher-geschnetzeltes" → "Zuercher geschnetzeltes"). */
export function titleFromLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const site = url.hostname.replace(/^www\./, "");
  const segment = url.pathname
    .split("/")
    .filter((s) => s !== "")
    .pop();
  let words = "";
  try {
    words = decodeURIComponent(segment ?? "")
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+]+/g, " ")
      .trim();
  } catch {
    words = "";
  }
  // A path of ids or hashes says nothing about the dish.
  if (words.length < 3 || /^[\d\s]+$/.test(words) || (!/\s/.test(words) && /\d/.test(words) && words.length > 12))
    return `Rezept von ${site}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const isWebLink = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim());
