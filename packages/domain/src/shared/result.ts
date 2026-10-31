/** A domain rule either succeeds with a value or is rejected with the name of the precondition that failed. */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The new state of an aggregate together with the events the change raised. */
export interface Outcome<S, E> {
  readonly state: S;
  readonly events: readonly E[];
}

export const succeed = <T>(value: T): Result<T> => ({ ok: true, value });
export const reject = (reason: string): Result<never> => ({ ok: false, reason });
