import { type ReactNode, useState } from "react";
import { ApiError } from "../../api/errors";
import { Button } from "../../components/ui";

/** Pieces shared by the screens of the sports content. */

/** Errors of a form: the banner, and the messages of the fields keyed like the API's. */
export interface FormErrors {
  readonly message?: string;
  readonly fields?: Record<string, string>;
}

/** Turns what a call threw into the errors of a form, in French. */
export function formErrors(error: unknown, fallback: string): FormErrors {
  if (error instanceof ApiError) {
    return { message: error.message, fields: error.fields };
  }
  return { message: fallback };
}

/** `datetime-local` value (local time) of an instant. */
export function toLocalInput(time: number | null): string {
  if (time === null) {
    return "";
  }
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Instant of a `datetime-local` value (local time); `null` when empty or invalid. */
export function fromLocalInput(value: string): number | null {
  if (value === "") {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** A number typed in a field (comma or point): `null` when empty, `NaN` when not a number. */
export function numberOrNull(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  return trimmed === "" ? null : Number(trimmed);
}

export const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** « 1 sept. 2026 » from a `YYYY-MM-DD` day. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) {
    return day;
  }
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(year, month - 1, date),
  );
}

/** A delete button asking for a second click. */
export function DeleteButton(props: {
  label: string;
  onConfirm: () => Promise<void> | void;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        variant="outline"
        className="px-3 py-1 text-xs"
        aria-label={`Supprimer ${props.label}`}
        onClick={() => setConfirming(true)}
      >
        Supprimer
      </Button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <Button
        className="bg-red-700 px-3 py-1 text-xs hover:bg-red-800"
        onClick={() => {
          setConfirming(false);
          void props.onConfirm();
        }}
      >
        Confirmer la suppression
      </Button>
      <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setConfirming(false)}>
        Annuler
      </Button>
    </span>
  );
}

export function PageHeader(props: { title: string; children?: ReactNode }): ReactNode {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold text-slate-900">{props.title}</h1>
      {props.children !== undefined && <p className="text-sm text-slate-600">{props.children}</p>}
    </header>
  );
}

/** Confirmation shown after a save, for screen readers too. */
export function Saved({ message }: { message: string | undefined }): ReactNode {
  return message === undefined ? null : (
    <p role="status" className="text-sm text-emerald-700">
      {message}
    </p>
  );
}

export const TEXTAREA_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900";
