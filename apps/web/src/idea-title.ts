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

/** One idea per non-empty line; a link on the line becomes the idea's link, the rest of the line its title. */
export function parseIdeaLines(text: string): { title: string; inspirationLink?: string }[] {
  const seen = new Set<string>();
  const ideas: { title: string; inspirationLink?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const link = trimmed.match(/https?:\/\/\S+/i)?.[0];
    const rest = link ? trimmed.replace(link, "").trim() : trimmed;
    const title = (rest === "" && link ? titleFromLink(link) : rest).slice(0, 200);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ideas.push(link ? { title, inspirationLink: link } : { title });
  }
  return ideas;
}
