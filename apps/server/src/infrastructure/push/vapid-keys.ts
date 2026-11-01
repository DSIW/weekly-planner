import type { Database } from "../sqlite/database.js";

interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

const KEY = "vapid_keys";

/**
 * The server's identity towards the push services. Made once and kept in the database: a new pair would silently
 * end every subscription, since each one is tied to the public key it was made with.
 */
export function loadOrCreateVapidKeys(db: Database, generate: () => VapidKeys): VapidKeys {
  const row = db.prepare("select value from setting where key = ?").get(KEY);
  if (row) return JSON.parse(row.value as string) as VapidKeys;
  const keys = generate();
  db.prepare("insert into setting (key, value) values (?, ?)").run(KEY, JSON.stringify(keys));
  return keys;
}
