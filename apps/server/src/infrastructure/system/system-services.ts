import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator, Randomness } from "@weekly-planner/application";
import { localDateTime, planDate, type LocalDateTime, type PlanDate } from "@weekly-planner/domain";

/** Adapter: the real clock, reading wall-clock time in the household's time zone. */
export class SystemClock implements Clock {
  constructor(private readonly timezone: string) {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); // throws on an unknown zone, at startup
  }

  now(): number {
    return Date.now();
  }

  today(): PlanDate {
    return this.localNow().date;
  }

  localNow(): LocalDateTime {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return localDateTime(planDate(`${get("year")}-${get("month")}-${get("day")}`), Number(get("hour")));
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/**
 * Adapter: a value in [0, 1) that is the same for the same key (FNV-1a hash), so a deck breaks ties the same way
 * on every request; without a key it is fresh each time.
 */
export class SystemRandomness implements Randomness {
  random(key?: string): number {
    if (key === undefined) return Math.random();
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x1_0000_0000;
  }
}
