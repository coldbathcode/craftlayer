"use client";
import { type ReactNode, useEffect, useRef } from "react";
import type { Power } from "./lib";
import { powerWord } from "./lib";
import type { ActionStatus } from "./use-action";

/** On/Off is never colour alone: a shape and a word say it too. */
export function PowerBadge({ power }: { power: Power }) {
  const mark = power === "on" ? "●" : power === "starting" ? "◐" : "○";
  return (
    <span className={`fam-power fam-power-${power}`}>
      <span aria-hidden="true">{mark}</span> {powerWord[power]}
    </span>
  );
}
/** One polite announcement per change, not a running commentary. */
export function StatusLine({ status }: { status: ActionStatus }) {
  if (status.kind === "idle") return null;
  return (
    <p
      className={`fam-status fam-status-${status.kind}`}
      role={status.kind === "failed" ? "alert" : "status"}
    >
      {status.text}
    </p>
  );
}
/** A plain-language question before anything that disconnects or removes someone. */
export function Confirm({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="fam-dialog"
      aria-labelledby="fam-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="fam-confirm-title">{title}</h2>
      <p>{body}</p>
      <div className="fam-row">
        <button type="button" className="fam-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="fam-button fam-danger"
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
export function Card({
  title,
  children,
  tone,
}: {
  title?: string;
  children: ReactNode;
  tone?: "attention";
}) {
  return (
    <section className={`fam-card${tone ? ` fam-card-${tone}` : ""}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
