/** Badges — same markup as IM.badge / IM.statusBadge (app.js). */
import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";

export type BadgeKind =
  | "draft"
  | "posted"
  | "reversed"
  | "reversal"
  | "low"
  | "archived"
  | "active"
  | "surplus"
  | "shortage"
  | "neutral"
  | "info";

const BADGES: Record<BadgeKind, { cls: string; label: string; icon?: IconName }> = {
  draft: { cls: "badge-draft", label: "Draft" },
  posted: { cls: "badge-posted", label: "Posted" },
  reversed: { cls: "badge-reversed", label: "Reversed" },
  reversal: { cls: "badge-reversal", label: "Reversal" },
  low: { cls: "badge-low", label: "Low stock", icon: "alert-triangle" },
  archived: { cls: "badge-archived", label: "Archived", icon: "archive" },
  active: { cls: "badge-posted", label: "Active" },
  surplus: { cls: "badge-surplus", label: "Surplus" },
  shortage: { cls: "badge-shortage", label: "Shortage" },
  neutral: { cls: "badge-neutral", label: "" },
  info: { cls: "badge-info", label: "" },
};

export interface BadgeProps {
  kind: BadgeKind;
  /** Overrides the default label of the kind. */
  label?: JSX.Element;
}

export function Badge(props: BadgeProps): JSX.Element {
  const b = () => BADGES[props.kind] ?? BADGES.neutral;
  return (
    <span class={`badge ${b().cls}${b().icon ? " has-icon" : ""}`}>
      <Show when={b().icon}>{(icon) => <Icon name={icon()} size={14} />}</Show>
      {props.label ?? b().label}
    </span>
  );
}

/** Minimal document shape for StatusBadge (API document: kind + status). */
export interface DocLike {
  kind?: string | null;
  status?: string | null;
}

export function isReversalKind(kind: string | null | undefined): boolean {
  return kind === "receipt_reversal" || kind === "write_off_reversal";
}

/** Draft / Posted / Reversed for documents; reversal documents → "Reversal". */
export function StatusBadge(props: { doc: DocLike | null | undefined }): JSX.Element {
  return (
    <Show when={props.doc}>
      {(doc) => (
        <Badge
          kind={
            isReversalKind(doc().kind)
              ? "reversal"
              : doc().status && doc().status! in BADGES
                ? (doc().status as BadgeKind)
                : "neutral"
          }
        />
      )}
    </Show>
  );
}
