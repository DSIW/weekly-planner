type Brand<T, B extends string> = T & { readonly __brand: B };

/** A household member. Authentication is outside the domain; an id is all the rules need. */
export type MemberId = Brand<string, "MemberId">;
export const memberId = (s: string): MemberId => s as MemberId;

export type SessionId = Brand<string, "SessionId">;
export const sessionId = (s: string): SessionId => s as SessionId;

export type ProposalId = Brand<string, "ProposalId">;
export const proposalId = (s: string): ProposalId => s as ProposalId;

export type MealLogEntryId = Brand<string, "MealLogEntryId">;
export const mealLogEntryId = (s: string): MealLogEntryId => s as MealLogEntryId;
