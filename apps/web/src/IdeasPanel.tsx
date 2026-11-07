import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import {
  addIdea,
  deleteIdea,
  editIdea,
  fetchIdeas,
  IdeaFailed,
  keepIdea,
  listenForChanges,
  memberAvatarUrl,
  type Idea,
  type IdeaInput,
  type RecipeDraft,
} from "./api";
import { relativeTime } from "./dates";
import { DraftReview } from "./ImportPanel";
import { claudeSearchUrl } from "./claude-search";
import { ResearchPanel, SearchButton, useIdeaResearch } from "./IdeaResearch";
import { OverflowMenu } from "./OverflowMenu";
import { Loading } from "./Loading";

const MESSAGES: Record<string, string> = {
  empty_title: "Bitte einen Titel eingeben.",
  invalid_request: "Bitte einen gültigen Link mit http oder https eingeben.",
  idea_not_found: "Diese Idee gibt es nicht mehr.",
  not_stale: "Diese Idee ist noch nicht veraltet.",
};
const messageFor = (e: unknown): string =>
  MESSAGES[e instanceof IdeaFailed ? e.reason : "unavailable"] ??
  "Das hat nicht geklappt. Bitte später noch einmal versuchen.";

/** Only web links become links: the text is a member's, and `javascript:` must never be clickable. */
const isWebLink = (value: string): boolean => /^https?:\/\//i.test(value);

/** The member's KitchenOwl picture, or the first letter of their name when there is none (or it does not load). */
function Avatar({ member }: { member: Idea["addedBy"] }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="avatar" aria-hidden="true">
      {member.avatar && !broken ? (
        <img src={memberAvatarUrl(member.id, member.avatar)} alt="" onError={() => setBroken(true)} />
      ) : (
        member.name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

function IdeaForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Idea;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (idea: IdeaInput) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [link, setLink] = useState(initial?.inspirationLink ?? "");
  return (
    <form
      className="idea-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit({
          title: title.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(link.trim() ? { inspirationLink: link.trim() } : {}),
        });
      }}
    >
      <label>
        Titel
        <input value={title} maxLength={200} onChange={(ev) => setTitle(ev.target.value)} required />
      </label>
      <label>
        Notiz (optional)
        <textarea value={note} rows={2} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} />
      </label>
      <label>
        Link zur Inspiration (optional)
        <input type="url" inputMode="url" value={link} maxLength={2000} onChange={(ev) => setLink(ev.target.value)} />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="idea-actions">
        <button type="submit" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" disabled={pending} onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

function IdeaCard({
  idea,
  onChanged,
  onDraft,
}: {
  idea: Idea;
  onChanged: () => void;
  onDraft: (draft: RecipeDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const edit = useMutation({
    mutationFn: (input: IdeaInput) => editIdea(idea.id, input),
    onSuccess: () => setEditing(false),
    onSettled: onChanged,
  });
  const keep = useMutation({ mutationFn: () => keepIdea(idea.id), onSettled: onChanged });
  const remove = useMutation({ mutationFn: () => deleteIdea(idea.id), onSettled: onChanged });
  const research = useIdeaResearch(idea, onChanged, onDraft);
  const busy = edit.isPending || keep.isPending || remove.isPending;
  const failure = keep.error ?? remove.error;
  const locked = busy || confirming || research.busy;
  const link = idea.inspirationLink && isWebLink(idea.inspirationLink) ? idea.inspirationLink : null;
  const hintId = useId();
  const labelId = useId();

  return (
    <li className={idea.isStale ? "idea stale" : "idea"}>
      <div className="idea-row">
        <Avatar member={idea.addedBy} />
        <div className="idea-main">
          <h3>{idea.title}</h3>
          <p className="idea-meta">
            {idea.addedBy.name} · {relativeTime(idea.addedAt)}
            {idea.isStale && <span className="badge stale-badge">veraltet</span>}
            {link && (
              <>
                {" · "}
                <a className="idea-link" href={link} target="_blank" rel="noopener noreferrer">
                  Inspiration ansehen
                </a>
              </>
            )}
          </p>
          {idea.note && <p className="idea-note">{idea.note}</p>}
        </div>
        {idea.isStale && !confirming && (
          <button
            type="button"
            className="small"
            disabled={busy}
            aria-label={`${idea.title} behalten`}
            onClick={() => keep.mutate()}
          >
            Behalten
          </button>
        )}
        <SearchButton idea={idea} research={research} disabled={busy || confirming} />
        <OverflowMenu label={`${idea.title}: Weitere Aktionen`}>
          <button
            type="button"
            role="menuitem"
            disabled={locked}
            onClick={() => {
              research.setClosed(false);
              research.setOwn(true);
            }}
          >
            Eigenen Link einfügen
          </button>
          <a
            role="menuitem"
            href={claudeSearchUrl(idea)}
            target="_blank"
            rel="noopener noreferrer"
            aria-labelledby={labelId}
            aria-describedby={hintId}
          >
            <span id={labelId}>In Claude suchen</span>
            <span id={hintId} className="muted">
              Link danach unter „Eigenen Link einfügen“ einfügen
            </span>
          </a>
          <button type="button" role="menuitem" disabled={locked} onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={locked}
            onClick={() => {
              remove.reset();
              setConfirming(true);
            }}
          >
            Löschen
          </button>
        </OverflowMenu>
      </div>
      {failure && (
        <p role="alert" className="error idea-panel">
          {messageFor(failure)}
        </p>
      )}
      {editing && (
        <div className="idea-panel">
          <IdeaForm
            initial={idea}
            submitLabel="Speichern"
            pending={edit.isPending}
            error={edit.isError ? messageFor(edit.error) : null}
            onSubmit={(input) => edit.mutate(input)}
            onCancel={() => {
              edit.reset();
              setEditing(false);
            }}
          />
        </div>
      )}
      {confirming && (
        <div className="idea-panel idea-actions">
          <button
            type="button"
            className="danger"
            disabled={busy}
            aria-label={`${idea.title} wirklich löschen`}
            onClick={() => remove.mutate()}
          >
            Ja, löschen
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Abbrechen
          </button>
        </div>
      )}
      <ResearchPanel idea={idea} research={research} disabled={busy || confirming} />
    </li>
  );
}

/** The household's recipe ideas: note one, see who added it and when, edit, delete, and clean up the stale ones. */
export function IdeasPanel() {
  const client = useQueryClient();
  const ideas = useQuery({ queryKey: ["ideas"], queryFn: fetchIdeas });
  const changed = () => client.invalidateQueries({ queryKey: ["ideas"] });
  // The other phone's changes arrive live; the list is also fetched again after every (re)connect.
  useEffect(() => listenForChanges(() => void client.invalidateQueries({ queryKey: ["ideas"] })), [client]);
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: addIdea,
    onSuccess: () => setAdding(false),
    onSettled: changed,
  });
  // A picked candidate or an own source leads into the import's review, which carries the idea along.
  const [review, setReview] = useState<{ ideaId: string; draft: RecipeDraft } | null>(null);
  const all = ideas.data ?? [];
  const stale = all.filter((i) => i.isStale);
  const fresh = all.filter((i) => !i.isStale);

  if (review)
    return (
      <DraftReview
        initial={review.draft}
        ideaId={review.ideaId}
        finishedLabel="Zurück zu den Ideen"
        onDiscard={() => setReview(null)}
        onFinished={() => setReview(null)}
      />
    );

  return (
    <section className="card ideas">
      <div className="ideas-head">
        <h2>Ideen {ideas.data && <span className="muted ideas-count">({all.length})</span>}</h2>
        {!adding && (
          <button type="button" className="small" aria-label="Neue Idee hinzufügen" onClick={() => setAdding(true)}>
            + Neu
          </button>
        )}
      </div>
      {adding && (
        <IdeaForm
          submitLabel="Idee hinzufügen"
          pending={add.isPending}
          error={add.isError ? messageFor(add.error) : null}
          onSubmit={(input) => add.mutate(input)}
          onCancel={() => {
            add.reset();
            setAdding(false);
          }}
        />
      )}
      {ideas.isPending && <Loading what="Ideen werden geladen …" />}
      {ideas.isError && (
        <p role="alert" className="error">
          Die Ideen konnten nicht geladen werden.
        </p>
      )}
      {ideas.data && all.length === 0 && (
        <p className="muted">Noch keine Ideen. Hier landet alles, was ihr irgendwann einmal kochen möchtet.</p>
      )}
      {stale.length > 0 && (
        <>
          <h3 className="idea-group">
            Veraltet <span>· Lange nichts damit gemacht</span>
          </h3>
          <ul className="ideas-list" aria-label="Veraltete Ideen">
            {stale.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onChanged={changed}
                onDraft={(draft) => setReview({ ideaId: idea.id, draft })}
              />
            ))}
          </ul>
        </>
      )}
      {fresh.length > 0 && (
        <ul className="ideas-list" aria-label="Ideen">
          {fresh.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onChanged={changed}
              onDraft={(draft) => setReview({ ideaId: idea.id, draft })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
