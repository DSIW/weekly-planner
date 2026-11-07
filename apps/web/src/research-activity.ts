import { useSyncExternalStore } from "react";

/**
 * Which ideas are being researched right now, and which searches finished without the member looking at the Ideen
 * tab. A search is a request of up to a minute; it goes on when the member leaves the tab, so this lives outside the
 * components and the tab can show a badge.
 */
interface Activity {
  readonly running: ReadonlySet<string>;
  readonly unseen: ReadonlySet<string>;
}

let state: Activity = { running: new Set(), unseen: new Set() };
const listeners = new Set<() => void>();
const set = (next: Activity) => {
  state = next;
  for (const l of listeners) l();
};

export const researchStarted = (id: string) => set({ ...state, running: new Set(state.running).add(id) });

export function researchFinished(id: string, found: boolean) {
  const running = new Set(state.running);
  running.delete(id);
  set({ running, unseen: found ? new Set(state.unseen).add(id) : state.unseen });
}

/** The member is on the Ideen tab: what finished is no longer news. */
export const researchSeen = () => {
  if (state.unseen.size > 0) set({ ...state, unseen: new Set() });
};

export const useResearchActivity = (): Activity =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

/** For tests: forget everything. */
export const resetResearchActivity = () => set({ running: new Set(), unseen: new Set() });
