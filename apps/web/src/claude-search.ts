/** Longest prompt (before URL encoding) handed to claude.ai, to keep the address short. */
export const MAX_PROMPT_LENGTH = 1500;

const isWebLink = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`);

/** The German prompt for an idea; empty parts are left out, the whole is at most MAX_PROMPT_LENGTH long. */
export function claudePrompt(idea: { title: string; note: string | null; inspirationLink: string | null }): string {
  const title = idea.title.trim();
  const note = (idea.note ?? "").trim();
  const link = (idea.inspirationLink ?? "").trim();
  const tail = [
    link !== "" && isWebLink(link) ? `Inspiration: ${link}.` : "",
    "Gib mir pro Rezept Name, Link und zwei Sätze, warum es passt.",
  ].filter((p) => p !== "");
  const tailText = tail.join(" ");
  const head = "Finde 3 gute, möglichst gut bewertete Rezepte für: ";
  // The tail (link and request) is kept whole; the title, then the note, give way.
  let room = MAX_PROMPT_LENGTH - head.length - tailText.length - 2;
  const t = clip(title, Math.max(room, 20));
  room -= t.length;
  const n = note === "" ? "" : clip(note, Math.max(room - " Hinweis: .".length, 0));
  const parts = [`${head}${t}.`, n === "" ? "" : `Hinweis: ${n}.`, tailText].filter((p) => p !== "");
  return clip(parts.join(" "), MAX_PROMPT_LENGTH);
}

/** Address that opens claude.ai with the prompt filled in; nothing is sent by the planner. */
export const claudeSearchUrl = (idea: Parameters<typeof claudePrompt>[0]): string =>
  `https://claude.ai/new?q=${encodeURIComponent(claudePrompt(idea))}`;

/**
 * The German prompt that asks Claude to read a recipe page and answer in the plain layout the import's pasted-text path
 * reads well (the same sections as the page text the server makes: title, Portionen, Zeit, Zutaten, Zubereitung).
 * Null when the address is not an http(s) link.
 */
export function claudeExtractPrompt(address: string): string | null {
  const url = address.trim();
  if (!isWebLink(url)) return null;
  return [
    `Öffne diese Rezeptseite und gib mir das Rezept als reinen Text: ${url}`,
    "Antworte genau in diesem Aufbau und schreibe nichts davor oder danach:",
    "Erste Zeile: der Titel des Rezepts.",
    "Dann eine Zeile „Portionen: N“ und eine Zeile „Zeit: N Minuten“ (Gesamtzeit).",
    "Leerzeile, dann „Zutaten:“ mit einer Zutat pro Zeile, zum Beispiel „- 200 g Mehl“.",
    "Leerzeile, dann „Zubereitung:“ mit nummerierten Schritten, zum Beispiel „1. Mehl sieben.“",
    `Letzte Zeile: „Quelle: ${url}“.`,
    "Wenn du die Seite nicht öffnen kannst, sage das und erfinde kein Rezept.",
  ].join("\n");
}

/** Address that opens claude.ai with the extraction prompt filled in; null unless the address is an http(s) link. */
export function claudeExtractUrl(address: string): string | null {
  const prompt = claudeExtractPrompt(address);
  return prompt === null ? null : `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
