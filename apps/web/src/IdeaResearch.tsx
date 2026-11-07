import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  IdeaFailed,
  ImportFailed,
  pickCandidate,
  researchIdea,
  submitOwnSource,
  type Candidate,
  type Idea,
  type RecipeDraft,
} from "./api";
import { messageFor as importMessageFor } from "./DraftReview";
import { researchFinished, researchStarted, useResearchActivity } from "./research-activity";
import { Loading } from "./Loading";

const FALLBACK = "Das hat nicht geklappt. Bitte später noch einmal versuchen.";

const RESEARCH_MESSAGES: Record<string, string> = {
  rate_limited: "Zu viele Suchen. Bitte in einer Stunde noch einmal.",
  not_configured: "Die Rezeptsuche ist auf dem Server noch nicht eingerichtet.",
  // A failed search, an unusable answer and an empty one are all "nothing found": the old candidates stay.
  nothing_found: "Nichts gefunden – die bisherigen Vorschläge bleiben. Du kannst es noch einmal versuchen.",
  idea_not_found: "Diese Idee gibt es nicht mehr.",
};
const researchMessage = (e: unknown): string => (e instanceof IdeaFailed && RESEARCH_MESSAGES[e.reason]) || FALLBACK;

const HANDOFF_MESSAGES: Record<string, string> = {
  idea_not_found: "Diese Idee gibt es nicht mehr.",
  no_such_candidate: "Diesen Vorschlag gibt es nicht mehr. Bitte noch einmal suchen.",
};
/** The import's refusals (link not public, not a recipe, ...) are told as the import tells them. */
const handoffMessage = (e: unknown): string => {
  if (e instanceof IdeaFailed) return HANDOFF_MESSAGES[e.reason] ?? importMessageFor(new ImportFailed(e.reason));
  return FALLBACK;
};

/** The site of a link, for the member to judge a candidate by; nothing when the link is not a web link. */
const siteOf = (link: string): string | null => {
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const isLink = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);

/** The state of one idea's research: the search, the picking, the own source. Shared by the expanded row's buttons and panel. */
export function useIdeaResearch(idea: Idea, onChanged: () => void, onDraft: (draft: RecipeDraft) => void) {
  const [own, setOwn] = useState(false);
  const [ownText, setOwnText] = useState("");
  const [closed, setClosed] = useState(false);
  const activity = useResearchActivity();
  const search = useMutation({
    mutationFn: async () => {
      researchStarted(idea.id);
      try {
        const found = await researchIdea(idea.id);
        researchFinished(idea.id, true);
        return found;
      } catch (e) {
        researchFinished(idea.id, false);
        throw e;
      }
    },
    onSettled: onChanged,
  });
  // The request outlives the row: after a visit to another tab the row learns of it from the shared activity.
  const searching = search.isPending || activity.running.has(idea.id);
  const pick = useMutation({
    mutationFn: (n: number) => pickCandidate(idea.id, n),
    onSuccess: onDraft,
    // The idea's clock moved on the server either way.
    onSettled: onChanged,
  });
  const useOwn = useMutation({
    mutationFn: (text: string) => submitOwnSource(idea.id, isLink(text) ? { address: text } : { text }),
    onSuccess: onDraft,
    onSettled: onChanged,
  });
  const busy = searching || pick.isPending || useOwn.isPending;
  return { searching, own, setOwn, ownText, setOwnText, closed, setClosed, search, pick, useOwn, busy };
}
export type IdeaResearchState = ReturnType<typeof useIdeaResearch>;

const Magnifier = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);

/** The expanded row's primary action: ask the model for recipe candidates. */
export function SearchButton({
  research,
  disabled,
  onStart,
}: {
  research: IdeaResearchState;
  disabled: boolean;
  onStart: () => void;
}) {
  const { search, pick, busy, setClosed } = research;
  return (
    <button
      type="button"
      className="act act-primary act-wide"
      disabled={disabled || busy}
      onClick={() => {
        onStart();
        pick.reset();
        setClosed(false);
        search.mutate();
      }}
    >
      <Magnifier />
      Rezepte suchen
    </button>
  );
}

/** In the expanded row: the spinner, the errors, the own-source form and the candidates of one idea. */
export function ResearchPanel({
  idea,
  research,
  disabled,
}: {
  idea: Idea;
  research: IdeaResearchState;
  disabled: boolean;
}) {
  const { searching, own, setOwn, ownText, setOwnText, closed, setClosed, search, pick, useOwn, busy } = research;
  const candidates = idea.candidates ?? [];
  const showCandidates = candidates.length > 0 && !own && !closed;
  if (!own && !searching && !search.isError && candidates.length === 0) return null;

  return (
    <div className="idea-research">
      {searching && <Loading what="Es wird gesucht … das kann eine Minute dauern" />}
      {search.isError && (
        <p role="alert" className="error">
          {researchMessage(search.error)}
        </p>
      )}
      {own && (
        <form
          className="idea-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (ownText.trim() !== "") useOwn.mutate(ownText.trim());
          }}
        >
          <label>
            Link oder Rezepttext
            <textarea
              rows={3}
              maxLength={60000}
              placeholder="https://… oder den Text eines Rezepts einfügen"
              value={ownText}
              onChange={(ev) => setOwnText(ev.target.value)}
            />
          </label>
          {useOwn.isPending && <Loading what="Wird gelesen … das kann eine Minute dauern" />}
          {useOwn.isError && (
            <p role="alert" className="error">
              {handoffMessage(useOwn.error)}
            </p>
          )}
          <div className="idea-actions">
            <button type="submit" disabled={busy || ownText.trim() === ""}>
              Rezept lesen
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                useOwn.reset();
                setOwn(false);
              }}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {candidates.length > 0 && !own && (
        <button type="button" className="toggle-row" onClick={() => setClosed(!closed)}>
          {closed ? `Vorschläge zeigen (${candidates.length})` : "Vorschläge ausblenden"}
          <svg
            className={closed ? "chevron" : "chevron open"}
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
      {showCandidates && (
        <>
          <ul className="candidates" aria-label={`Vorschläge für ${idea.title}`}>
            {candidates.map((c, n) => (
              <CandidateItem
                // The server keeps no ids for candidates: their place is what a pick names.
                // biome-ignore lint/suspicious/noArrayIndexKey: a research replaces the whole list
                key={n}
                candidate={c}
                busy={busy || disabled}
                picking={pick.isPending && pick.variables === n}
                onPick={() => pick.mutate(n)}
              />
            ))}
          </ul>
          {pick.isError && (
            <p role="alert" className="error">
              {handoffMessage(pick.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CandidateItem({
  candidate,
  busy,
  picking,
  onPick,
}: {
  candidate: Candidate;
  busy: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  const site = siteOf(candidate.link);
  return (
    <li className="candidate">
      <strong>{candidate.title}</strong>
      {site && <span className="muted candidate-site">{site}</span>}
      {candidate.summary && <p className="candidate-summary">{candidate.summary}</p>}
      <div className="candidate-actions">
        {site && (
          <a className="idea-link" href={candidate.link} target="_blank" rel="noopener noreferrer">
            Seite ansehen
          </a>
        )}
        <button type="button" disabled={busy} aria-label={`${candidate.title} übernehmen`} onClick={onPick}>
          {picking ? "Wird gelesen … das kann eine Minute dauern" : "Übernehmen"}
        </button>
      </div>
    </li>
  );
}
