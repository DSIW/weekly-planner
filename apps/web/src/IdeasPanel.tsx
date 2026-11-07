import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
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
import { isWebLink as isLinkText, parseIdeaLines, titleFromLink } from "./idea-title";
import { Loading } from "./Loading";
import { researchSeen, useResearchActivity } from "./research-activity";
import { SwipeRow } from "./SwipeRow";

const MESSAGES: Record<string, string> = {
  empty_title: "Bitte einen Titel eingeben.",
  invalid_request: "Bitte einen gültigen Link mit http oder https eingeben.",
  idea_not_found: "Diese Idee gibt es nicht mehr.",
  not_stale: "Diese Idee ist noch nicht veraltet.",
};
const messageFor = (e: unknown): string =>
  MESSAGES[e instanceof IdeaFailed ? e.reason : "unavailable"] ??
  "Das hat nicht geklappt. Bitte später noch einmal versuchen.";

/** How long a swiped-away idea can be taken back before it is deleted. */
const UNDO_MS = 6000;

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
  initial?: { title: string; note?: string | null; inspirationLink?: string | null };
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

/** A 16px outline icon for the action buttons; `d` is its path. */
function ActIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "chevron open" : "chevron"}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * One idea: a collapsed row (avatar, title, meta, note, chevron) whose whole header toggles an inline panel with the
 * actions. `open` comes from the list (one row at a time). A row with unsaved work (edit form, own-link form, delete
 * confirmation, running search) stays expanded whatever the list says and ignores toggling until that is done.
 */
function IdeaCard({
  idea,
  open,
  onOpen,
  onClose,
  onChanged,
  onArchive,
  onDraft,
}: {
  idea: Idea;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChanged: () => void;
  /** The row was swiped away: the list takes it off and offers to bring it back before it is deleted for good. */
  onArchive: () => void;
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
  const pinned = editing || confirming || research.own || research.busy;
  const expanded = open || pinned;
  const link = idea.inspirationLink && isWebLink(idea.inspirationLink) ? idea.inspirationLink : null;
  const hintId = useId();
  const panelId = useId();
  const metaId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <li
      className={idea.isStale ? "idea stale" : "idea"}
      onKeyDown={(ev) => {
        if (ev.key === "Escape" && expanded && !pinned) {
          ev.stopPropagation();
          onClose();
          toggle.current?.focus();
        }
      }}
    >
      <SwipeRow
        left="Löschen"
        onLeft={onArchive}
        {...(idea.isStale ? { right: "Behalten", onRight: () => keep.mutate() } : {})}
        disabled={expanded || locked}
      >
        <div className="idea-row">
          <Avatar member={idea.addedBy} />
          <div className="idea-main">
            <h3>
              <button
                type="button"
                ref={toggle}
                className="idea-toggle-row"
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-describedby={metaId}
                onClick={() => {
                  if (pinned) return;
                  if (open) onClose();
                  else onOpen();
                }}
              >
                {idea.title}
              </button>
            </h3>
            <p className="idea-meta" id={metaId}>
              {idea.addedBy.name} · {relativeTime(idea.addedAt)}
              {idea.isStale && <span className="badge stale-badge">veraltet</span>}
              {research.searching ? (
                <span className="badge searching" role="status">
                  <span className="spinner" aria-hidden="true" />
                  Suche läuft …
                </span>
              ) : (
                idea.candidates.length > 0 && (
                  <span className="badge">
                    {idea.candidates.length} {idea.candidates.length === 1 ? "Vorschlag" : "Vorschläge"}
                  </span>
                )
              )}
              {link && !expanded && (
                <>
                  {" · "}
                  <a className="idea-link" href={link} target="_blank" rel="noopener noreferrer">
                    Inspiration ansehen
                  </a>
                </>
              )}
            </p>
            {idea.note && !expanded && <p className="idea-note">{idea.note}</p>}
          </div>
          {idea.isStale && !confirming && (
            <button
              type="button"
              className="small idea-keep"
              disabled={busy}
              aria-label={`${idea.title} behalten`}
              onClick={() => keep.mutate()}
            >
              Behalten
            </button>
          )}
          <Chevron open={expanded} />
        </div>
      </SwipeRow>
      {failure && (
        <p role="alert" className="error idea-panel">
          {messageFor(failure)}
        </p>
      )}
      {expanded && (
        <div id={panelId} className="idea-panel idea-expanded">
          {idea.note && <p className="idea-note-full">{idea.note}</p>}
          {link && (
            <p className="idea-note-full">
              <a className="idea-link" href={link} target="_blank" rel="noopener noreferrer">
                Inspiration ansehen
              </a>
            </p>
          )}
          <SearchButton research={research} disabled={busy || confirming} onStart={onOpen} />
          <div className="act-grid">
            <button
              type="button"
              className="act"
              aria-label="Eigenen Link einfügen"
              disabled={locked}
              onClick={() => {
                research.setClosed(false);
                research.setOwn(true);
              }}
            >
              <ActIcon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
              Eigenen Link
            </button>
            <a
              className="act"
              href={claudeSearchUrl(idea)}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={hintId}
            >
              <ActIcon d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              In Claude suchen
            </a>
            <button type="button" className="act" disabled={locked} onClick={() => setEditing(true)}>
              <ActIcon d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />
              Bearbeiten
            </button>
            <button
              type="button"
              className="act act-quiet"
              disabled={locked}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              <ActIcon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" />
              Löschen
            </button>
          </div>
          <p id={hintId} className="muted idea-hint">
            Antwort danach über „Eigenen Link einfügen“ einfügen.
          </p>
          {editing && (
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
          )}
          {confirming && (
            <div className="idea-actions">
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
        </div>
      )}
    </li>
  );
}

/**
 * The quickest way to note an idea: one line. A pasted link becomes the idea's link and a guess from the address its
 * title; "Mehr" opens the full form with what is typed so far.
 */
function QuickAdd({
  pending,
  error,
  known,
  bulk,
  onAdd,
  onAddMany,
  onMore,
}: {
  pending: boolean;
  error: string | null;
  /** Lower-cased titles of the ideas that exist, so a pasted list does not add them twice. */
  known: ReadonlySet<string>;
  bulk: { done: number; total: number; failed: number } | null;
  onAdd: (idea: IdeaInput, done: () => void) => void;
  onAddMany: (ideas: IdeaInput[], done: () => void) => void;
  onMore: (prefill: { title: string; inspirationLink?: string }) => void;
}) {
  const [text, setText] = useState("");
  const typed = text.trim();
  // Several lines (a list pasted from a note) become one idea each.
  const lines = parseIdeaLines(text);
  const many = lines.length > 1;
  const fresh = lines.filter((l) => !known.has(l.title.toLowerCase()));
  const running = bulk !== null && bulk.done < bulk.total;
  const isLink = isLinkText(typed);
  const guess = isLink ? titleFromLink(typed) : typed;
  const prefill = isLink ? { title: guess, inspirationLink: typed } : { title: guess };
  return (
    <form
      className="quick-add"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (typed === "") return;
        if (many) {
          if (fresh.length > 0 && !running) onAddMany(fresh, () => setText(""));
          return;
        }
        onAdd(isLink ? { title: guess, inspirationLink: typed } : { title: typed }, () => setText(""));
      }}
    >
      <div className="quick-add-row">
        <textarea
          rows={many ? Math.min(lines.length, 6) : 1}
          value={text}
          maxLength={20000}
          placeholder="Neue Idee oder Link einfügen …"
          aria-label="Neue Idee"
          enterKeyHint="done"
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            // Enter adds, as in the one-line field it was; Shift+Enter starts another line of a list.
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              ev.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={pending || running || typed === "" || (many && fresh.length === 0)}>
          {many ? `${fresh.length} Ideen hinzufügen` : "Hinzufügen"}
        </button>
      </div>
      {many && (
        <p className="muted quick-add-hint">
          {lines.length} Zeilen erkannt
          {fresh.length < lines.length && ` – ${lines.length - fresh.length} davon gibt es schon`}.
        </p>
      )}
      {bulk && (
        <p role="status" className={bulk.failed > 0 ? "error" : "muted"}>
          {running
            ? `Wird hinzugefügt … ${bulk.done} von ${bulk.total}`
            : bulk.failed > 0
              ? `${bulk.failed} von ${bulk.total} Ideen konnten nicht hinzugefügt werden. Bitte noch einmal versuchen: Vorhandene werden übersprungen.`
              : null}
        </p>
      )}
      {!many && isLink && (
        <p className="muted quick-add-hint">
          Link erkannt – Titel „{guess}“.{" "}
          <button type="button" className="link-text" onClick={() => onMore(prefill)}>
            Anpassen
          </button>
        </p>
      )}
      {!many && !isLink && typed !== "" && (
        <p className="muted quick-add-hint">
          <button type="button" className="link-text" onClick={() => onMore(prefill)}>
            Mit Notiz oder Link
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

type Filter = "all" | "stale" | "researched" | "mine";

/** Steps through the stale ideas one by one: keep, delete or leave for later. Nothing goes without a second tap. */
function Cleanup({
  queue,
  ideas,
  onChanged,
  onDone,
}: {
  queue: string[];
  ideas: Idea[];
  onChanged: () => void;
  onDone: () => void;
}) {
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const remaining = queue
    .map((id) => ideas.find((i) => i.id === id))
    .filter((i): i is Idea => i !== undefined && i.isStale && !later.has(i.id));
  const current = remaining[0];
  const next = () => setConfirming(false);
  const keep = useMutation({ mutationFn: (id: string) => keepIdea(id), onSuccess: next, onSettled: onChanged });
  const remove = useMutation({ mutationFn: (id: string) => deleteIdea(id), onSuccess: next, onSettled: onChanged });
  const busy = keep.isPending || remove.isPending;
  const failure = keep.error ?? remove.error;

  if (!current)
    return (
      <div className="cleanup">
        <p role="status" className="success">
          Aufgeräumt.
        </p>
        <button type="button" onClick={onDone}>
          Fertig
        </button>
      </div>
    );
  return (
    <div className="cleanup">
      <p className="muted" aria-live="polite">
        Aufräumen · {queue.length - remaining.length + 1} von {queue.length}
      </p>
      <h3>{current.title}</h3>
      <p className="idea-meta">
        {current.addedBy.name} · {relativeTime(current.addedAt)}
      </p>
      {current.note && <p className="idea-note-full">{current.note}</p>}
      {failure && (
        <p role="alert" className="error">
          {messageFor(failure)}
        </p>
      )}
      <div className="idea-actions">
        <button
          type="button"
          disabled={busy}
          aria-label={`${current.title} behalten`}
          onClick={() => keep.mutate(current.id)}
        >
          Behalten
        </button>
        {confirming ? (
          <button
            type="button"
            className="danger"
            disabled={busy}
            aria-label={`${current.title} wirklich löschen`}
            onClick={() => remove.mutate(current.id)}
          >
            Ja, löschen
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            aria-label={`${current.title} löschen`}
            onClick={() => setConfirming(true)}
          >
            Löschen
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setLater((l) => new Set(l).add(current.id));
          }}
        >
          Später
        </button>
      </div>
      <button type="button" className="link-text" onClick={onDone}>
        Aufräumen beenden
      </button>
    </div>
  );
}

/** The household's recipe ideas: note one, see who added it and when, edit, delete, and clean up the stale ones. */
export function IdeasPanel({ meId }: { meId?: string }) {
  const client = useQueryClient();
  const ideas = useQuery({ queryKey: ["ideas"], queryFn: fetchIdeas });
  const changed = () => client.invalidateQueries({ queryKey: ["ideas"] });
  // The other phone's changes arrive live; the list is also fetched again after every (re)connect.
  useEffect(() => listenForChanges(() => void client.invalidateQueries({ queryKey: ["ideas"] })), [client]);
  // Searches that finished while the member was elsewhere are news no longer once the list is in front of them.
  const activity = useResearchActivity();
  useEffect(() => {
    if (activity.unseen.size > 0) researchSeen();
  }, [activity.unseen]);
  // The full form (note and link), opened from the quick line with what was typed there.
  const [form, setForm] = useState<{ title: string; inspirationLink?: string } | null>(null);
  // Accordion: at most one row is opened by the member (a row with unsaved work additionally stays open by itself).
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // The stale ideas the cleanup walks through, fixed when it starts.
  const [cleanup, setCleanup] = useState<string[] | null>(null);
  const add = useMutation({ mutationFn: addIdea, onSettled: changed });
  // A pasted list: one idea after the other, so the order of the list is the order they were noted in.
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
  const addMany = async (inputs: IdeaInput[], clear: () => void) => {
    let failed = 0;
    setBulk({ done: 0, total: inputs.length, failed });
    for (const [n, input] of inputs.entries()) {
      try {
        await addIdea(input);
      } catch {
        failed++;
      }
      setBulk({ done: n + 1, total: inputs.length, failed });
    }
    await changed();
    if (failed === 0) {
      clear();
      setBulk(null);
    }
  };
  // Swiped away: hidden at once, deleted for good after a few seconds unless the member takes it back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [undoable, setUndoable] = useState<Idea[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const finish = useRef((_id: string) => {});
  finish.current = (id: string) => {
    const timer = timers.current.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.current.delete(id);
    setUndoable((list) => list.filter((i) => i.id !== id));
    // If the server refuses, the idea is back with the next fetch.
    void deleteIdea(id)
      .catch(() => {})
      .then(() => changed())
      .then(() =>
        setHidden((set) => {
          const rest = new Set(set);
          rest.delete(id);
          return rest;
        }),
      );
  };
  const archive = (idea: Idea) => {
    setHidden((set) => new Set(set).add(idea.id));
    setUndoable((list) => [...list, idea]);
    setOpenId((id) => (id === idea.id ? null : id));
    timers.current.set(
      idea.id,
      setTimeout(() => finish.current(idea.id), UNDO_MS),
    );
  };
  const undo = (id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setUndoable((list) => list.filter((i) => i.id !== id));
    setHidden((set) => {
      const rest = new Set(set);
      rest.delete(id);
      return rest;
    });
  };
  // Leaving the tab means "yes, delete": nothing waits on a screen that is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of [...pending.keys()]) finish.current(id);
    };
  }, []);
  // A picked candidate or an own source leads into the import's review, which carries the idea along.
  const [review, setReview] = useState<{ ideaId: string; draft: RecipeDraft } | null>(null);
  const all = (ideas.data ?? []).filter((i) => !hidden.has(i.id));
  const matches: Record<Filter, (i: Idea) => boolean> = {
    all: () => true,
    stale: (i) => i.isStale,
    researched: (i) => i.candidates.length > 0,
    mine: (i) => i.addedBy.id === meId,
  };
  const counts: Record<Filter, number> = {
    all: all.length,
    stale: all.filter(matches.stale).length,
    researched: all.filter(matches.researched).length,
    mine: meId === undefined ? 0 : all.filter(matches.mine).length,
  };
  // A filter that has run out of ideas (the last stale one was kept) falls back to everything.
  const active: Filter = filter !== "all" && counts[filter] === 0 ? "all" : filter;
  const shown = all.filter(matches[active]);
  const stale = shown.filter((i) => i.isStale);
  const fresh = shown.filter((i) => !i.isStale);
  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "Alle" },
    { id: "stale", label: "Veraltet" },
    { id: "researched", label: "Mit Vorschlägen" },
    { id: "mine", label: "Von mir" },
  ];
  const row = (idea: Idea) => (
    <IdeaCard
      key={idea.id}
      idea={idea}
      open={openId === idea.id}
      onOpen={() => setOpenId(idea.id)}
      onClose={() => setOpenId((id) => (id === idea.id ? null : id))}
      onChanged={changed}
      onArchive={() => archive(idea)}
      onDraft={(draft) => setReview({ ideaId: idea.id, draft })}
    />
  );

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
      </div>
      {form ? (
        <IdeaForm
          initial={form}
          submitLabel="Idee hinzufügen"
          pending={add.isPending}
          error={add.isError ? messageFor(add.error) : null}
          onSubmit={(input) => add.mutate(input, { onSuccess: () => setForm(null) })}
          onCancel={() => {
            add.reset();
            setForm(null);
          }}
        />
      ) : (
        <QuickAdd
          pending={add.isPending}
          error={add.isError ? messageFor(add.error) : null}
          known={new Set(all.map((i) => i.title.trim().toLowerCase()))}
          bulk={bulk}
          onAdd={(input, done) => add.mutate(input, { onSuccess: done })}
          onAddMany={addMany}
          onMore={(prefill) => {
            add.reset();
            setForm(prefill);
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
        <div className="empty-state">
          <p>Noch keine Ideen.</p>
          <p className="muted">
            Schreib oben ein Gericht auf, das ihr einmal kochen möchtet – oder füge einen Link ein. Aus einer Idee wird
            per Suche ein Rezept, das ihr einplanen könnt. Links aus dem Browser lassen sich auch direkt mit der App
            teilen.
          </p>
        </div>
      )}
      {all.length > 0 && !cleanup && (
        <fieldset className="chips">
          <legend className="sr-only">Ideen filtern</legend>
          {chips
            .filter((c) => c.id === "all" || counts[c.id] > 0)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={active === c.id}
                onClick={() => setFilter(c.id)}
              >
                {c.label} <span>{counts[c.id]}</span>
              </button>
            ))}
        </fieldset>
      )}
      {cleanup ? (
        <Cleanup queue={cleanup} ideas={all} onChanged={changed} onDone={() => setCleanup(null)} />
      ) : (
        <>
          {counts.stale > 0 && (
            <button
              type="button"
              className="secondary small cleanup-start"
              onClick={() => setCleanup(all.filter((i) => i.isStale).map((i) => i.id))}
            >
              Veraltete aufräumen ({counts.stale})
            </button>
          )}
          {stale.length > 0 && (
            <>
              {active !== "stale" && (
                <h3 className="idea-group">
                  Veraltet <span>· Lange nichts damit gemacht</span>
                </h3>
              )}
              <ul className="ideas-list" aria-label="Veraltete Ideen">
                {stale.map(row)}
              </ul>
            </>
          )}
          {fresh.length > 0 && (
            <ul className="ideas-list" aria-label="Ideen">
              {fresh.map(row)}
            </ul>
          )}
        </>
      )}
      {undoable.length > 0 && (
        <div className="toasts">
          {undoable.map((i) => (
            <p key={i.id} role="status" className="toast">
              <span>„{i.title}“ gelöscht</span>
              <button type="button" className="link-text" onClick={() => undo(i.id)}>
                Rückgängig
              </button>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
