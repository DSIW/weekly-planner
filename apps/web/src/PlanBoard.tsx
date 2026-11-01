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
import type { PlanSession } from "./api";
import { dayLabel } from "./dates";
import { dropFor, type Drop } from "./plan-moves";

const STATUS = { open: "offen", planned: "geplant", leftovers: "Reste" } as const;

interface Props {
  session: PlanSession;
  onClose: () => void;
  onLeftovers: (date: string) => void;
  onReopen: (date: string) => void;
  onDrop: (drop: Drop) => void;
  pending: boolean;
  error: string | null;
}

type Day = PlanSession["days"][number];

function DayRow({
  day,
  busy,
  readOnly,
  onLeftovers,
  onReopen,
}: { day: Day; busy: boolean; readOnly: boolean } & Pick<Props, "onLeftovers" | "onReopen">) {
  const planned = day.status === "planned" && !readOnly;
  const drag = useDraggable({ id: day.date, disabled: !planned });
  const drop = useDroppable({ id: day.date, disabled: day.status === "leftovers" });
  const label = dayLabel(day.date);
  return (
    <li
      ref={drop.setNodeRef}
      className={`${drop.isOver ? "over " : ""}${drag.isDragging ? "dragging" : ""}`}
      style={drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)` } : undefined}
    >
      {planned && (
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
      )}
      <span>{label}</span>
      <span className={day.recipe ? "" : "muted"}>{day.recipe ? day.recipe.name : STATUS[day.status]}</span>
      {!readOnly && day.status === "open" && (
        <button type="button" className="secondary small" disabled={busy} onClick={() => onLeftovers(day.date)}>
          Reste
        </button>
      )}
      {!readOnly && day.status !== "open" && (
        <button type="button" className="secondary small" disabled={busy} onClick={() => onReopen(day.date)}>
          Wieder öffnen
        </button>
      )}
    </li>
  );
}

export function PlanBoard({ session, onClose, onLeftovers, onReopen, onDrop, pending, error }: Props) {
  // A handle drags at once with the mouse; on a touch screen it needs a short press, so scrolling stays possible.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  // A finalized plan is locked.
  const readOnly = session.status !== "open";
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const drop = over ? dropFor(session.days, String(active.id), String(over.id)) : null;
    if (drop) onDrop(drop);
  };
  return (
    <section className="card">
      <h2>{readOnly ? "Abgeschlossene Planung" : "Planung"}</h2>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <ul className="days">
          {session.days.map((day) => (
            <DayRow
              key={day.date}
              day={day}
              busy={pending}
              readOnly={readOnly}
              onLeftovers={onLeftovers}
              onReopen={onReopen}
            />
          ))}
        </ul>
      </DndContext>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" className="secondary" onClick={onClose} disabled={pending}>
        {readOnly ? "Planung schließen" : "Planung verwerfen"}
      </button>
    </section>
  );
}
