import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * Minimal components in the style of shadcn/ui (Tailwind, accessible), hand-written so the
 * back-office carries no component library: button, field, label, card, error messages.
 */

/** Class names joined the simple way; the design stays minimal on purpose. */
export function cn(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

const BUTTON_VARIANTS = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-slate-900 aria-disabled:bg-slate-400",
  outline:
    "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 focus-visible:outline-slate-900",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof BUTTON_VARIANTS;
}

export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900",
        "placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900",
        "aria-[invalid=true]:border-red-600",
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-6 shadow-sm", className)}>
      {children}
    </div>
  );
}

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  /** Error message under the field (French, from the client or the API). */
  readonly error?: string;
  /** Hint under the label, before the field. */
  readonly hint?: string;
  readonly children: ReactNode;
}

/** One labeled field, with its error message when the value is wrong. */
export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
      {error !== undefined && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Error banner of a form (a mapped French message; never a raw English one). */
export function FormError({ message }: { message: string | undefined }) {
  if (message === undefined) {
    return null;
  }
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}
