import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { PlanSession } from "./api";
import { dayLabel, dayParts } from "./dates";
import { dropFor, type Drop } from "./plan-moves";
import { RecipeLine } from "./RecipeLine";

interface Props {
  session: PlanSession;
  /** The signed-in member: a waiting proposal of theirs can be withdrawn, one of the other member waits for them. */
  meId: string;
  onClose: () => void;
  onLeftovers: (date: string) => void;
  onReopen: (date: string) => void;
  onDrop: (drop: Drop) => void;
  onWithdraw: (proposalId: string) => void;
  /** Goes on to the shopping list; absent on a finished plan. */
  onNext?: () => void;
  /** Why the shopping list cannot be reached yet; null when it can. */
  nextBlocked?: string | null;
  pending: boolean;
  error: string | null;
}

type Day = PlanSession["days"][number];
type Proposal = PlanSession["proposals"][number];

interface RowProps {
  day: Day;
  proposal: Proposal | undefined;
  meId: string;
  /** The day the deck fills next. */
  isNext: boolean;
  busy: boolean;
  readOnly: boolean;
  onLeftovers: (date: string) => void;
  onReopen: (date: string) => void;
  onWithdraw: (proposalId: string) => void;
}

function DayRow({ day, proposal, meId, isNext, busy, readOnly, onLeftovers, onReopen, onWithdraw }: RowProps) {
  const planned = day.status === "planned" && !readOnly;
  const drag = useDraggable({ id: day.date, disabled: !planned });
  const drop = useDroppable({ id: day.date, disabled: day.status === "leftovers" });
  const label = dayLabel(day.date);
  const parts = dayParts(day.date);
  const small = (text: string, onClick: () => void) => (
    <button type="button" className="secondary small" disabled={busy} onClick={onClick}>
      {text}
    </button>
  );

  let body: ReactNode;
  if (day.status === "planned" && day.recipe) {
    body = (
      <RecipeLine
        recipe={day.recipe}
        detail={day.removedInPlanner ? "in KitchenOwl entfernt" : undefined}
        end={!readOnly && small("Neu wählen", () => onReopen(day.date))}
      />
    );
  } else if (day.status === "leftovers") {
    body = (
      <span className="day-plain">
        <strong>Reste</strong>
        {!readOnly && small("Doch kochen", () => onReopen(day.date))}
      </span>
    );
  } else if (proposal) {
    const mine = proposal.proposedBy === meId;
    body = (
      <RecipeLine
        recipe={proposal.recipe}
        detail={mine ? "wartet auf Antwort" : "wartet auf deine Antwort"}
        end={mine && small("Zurückziehen", () => onWithdraw(proposal.id))}
      />
    );
  } else {
    body = (
      <span className="day-plain">
        <span className="muted">{isNext ? "Als Nächstes dran" : "noch offen"}</span>
        {!readOnly && small("Reste", () => onLeftovers(day.date))}
      </span>
    );
  }

  const state = proposal ? "waiting" : day.status;
  return (
    <li
      ref={drop.setNodeRef}
      data-state={state}
      className={`day ${isNext ? "next " : ""}${drop.isOver ? "over " : ""}${drag.isDragging ? "dragging" : ""}`}
      style={drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)` } : undefined}
    >
      {planned ? (
        <button
          type="button"
          className="handle"
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          aria-label={`${label} verschieben`}
        >
          ⠿
        </button>
      ) : (
        <span className="handle-space" />
      )}
      <span className="day-badge">
        <b aria-hidden="true">{parts.weekday}</b>
        <span aria-hidden="true">{parts.date}</span>
        <span className="sr-only">{label}</span>
      </span>
      <span className="day-body">{body}</span>
    </li>
  );
}

/**
 * The plan as one list: every day with what is agreed, what waits for an answer (yours can be withdrawn) and what is
 * still open. While the plan is open it also leads on to the shopping list; a finished plan is read-only.
 */
export function PlanBoard({
  session,
  meId,
  onClose,
  onLeftovers,
  onReopen,
  onDrop,
  onWithdraw,
  onNext,
  nextBlocked = null,
  pending,
  error,
}: Props) {
  // A handle drags at once with the mouse; on a touch screen it needs a short press, so scrolling stays possible.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  // A finalized plan is locked.
  const readOnly = session.status !== "open";
  const waitingOn = (date: string) => session.proposals.find((p) => p.date === date && p.status === "pending");
  const nextDate = session.days.find((d) => d.status === "open" && !waitingOn(d.date))?.date;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const drop = over ? dropFor(session.days, String(active.id), String(over.id)) : null;
    if (drop) onDrop(drop);
  };
  return (
    <section className="card">
      <h2>{readOnly ? "Abgeschlossene Planung" : "Planung"}</h2>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <ul className="days" aria-label="Tage der Planung">
          {session.days.map((day) => (
            <DayRow
              key={day.date}
              day={day}
              proposal={waitingOn(day.date)}
              meId={meId}
              isNext={!readOnly && day.date === nextDate}
              busy={pending}
              readOnly={readOnly}
              onLeftovers={onLeftovers}
              onReopen={onReopen}
              onWithdraw={onWithdraw}
            />
          ))}
        </ul>
      </DndContext>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {onNext && (
        <>
          <button type="button" onClick={onNext} disabled={pending || nextBlocked !== null}>
            Weiter zur Einkaufsliste
          </button>
          {nextBlocked && <p className="muted">{nextBlocked}</p>}
        </>
      )}
      <button type="button" className="secondary" onClick={onClose} disabled={pending}>
        {readOnly ? "Planung schließen" : "Planung verwerfen"}
      </button>
    </section>
  );
}
