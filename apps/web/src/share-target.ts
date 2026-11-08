/**
 * What the phone's share sheet handed over (the manifest's `share_target`): the first web link among `url` and `text`,
 * else the shared text itself, else nothing. Browsers differ in which field carries the link.
 */
export function sharedFrom(search: string): string | null {
  const params = new URLSearchParams(search);
  const fields = [params.get("url"), params.get("text"), params.get("title")].map((v) => v?.trim() ?? "");
  for (const field of fields) {
    const link = field.match(/https?:\/\/\S+/i)?.[0];
    if (link) return link;
  }
  const text = fields[1] || fields[2] || "";
  return text === "" ? null : text;
}

/** True when the address carries anything the share sheet sends, so it can be cleaned from the address bar. */
export const hasShare = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return params.has("url") || params.has("text") || params.has("title");
};
