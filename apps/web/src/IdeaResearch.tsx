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
import { claudeSearchUrl } from "./claude-search";
import { messageFor as importMessageFor } from "./ImportPanel";
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

/**
 * Research for one idea: ask for candidates, pick one, or hand over an own link or text. Picking and the own source
 * both end in the import's draft, which `onDraft` takes over to the import's review.
 */
export function IdeaResearch({
  idea,
  onChanged,
  onDraft,
  disabled,
}: {
  idea: Idea;
  onChanged: () => void;
  onDraft: (draft: RecipeDraft) => void;
  disabled: boolean;
}) {
  const [own, setOwn] = useState(false);
  const [ownText, setOwnText] = useState("");
  const search = useMutation({ mutationFn: () => researchIdea(idea.id), onSettled: onChanged });
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
  const busy = search.isPending || pick.isPending || useOwn.isPending;
  const candidates = idea.candidates ?? [];

  return (
    <div className="idea-research">
      {!own && (
        <div className="idea-actions">
          <button
            type="button"
            disabled={disabled || busy}
            aria-label={`${idea.title}: Rezepte suchen`}
            onClick={() => {
              pick.reset();
              search.mutate();
            }}
          >
            {candidates.length > 0 ? "Neu suchen" : "Rezepte suchen"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            aria-label={`${idea.title}: eigenen Link einfügen`}
            onClick={() => setOwn(true)}
          >
            Eigenen Link einfügen
          </button>
          <a
            className="idea-link"
            href={claudeSearchUrl(idea)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${idea.title}: In Claude suchen`}
          >
            In Claude suchen
          </a>
        </div>
      )}
      {!own && <p className="muted">Link danach unter „Eigenen Link einfügen“ einfügen.</p>}
      {search.isPending && <Loading what="Es wird gesucht … das kann eine Minute dauern" />}
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
              rows={4}
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
      {site && <span className="muted">{site}</span>}
      {candidate.summary && <p>{candidate.summary}</p>}
      {site && (
        <a className="idea-link" href={candidate.link} target="_blank" rel="noopener noreferrer">
          Seite ansehen
        </a>
      )}
      <button type="button" disabled={busy} aria-label={`${candidate.title} übernehmen`} onClick={onPick}>
        {picking ? "Wird gelesen … das kann eine Minute dauern" : "Dieses Rezept übernehmen"}
      </button>
    </li>
  );
}
