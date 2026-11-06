/** Small building blocks shared by the document screens (markup of screens/receipt.html). */
import { Show, createEffect, onCleanup, onMount, type JSX } from "solid-js";
import { Icon, type IconName } from "../../components/Icon";

export function DocAlert(props: {
  kind: "info" | "warning" | "danger";
  icon: IconName;
  title?: JSX.Element;
  children: JSX.Element;
  /** false → no `doc-alert` class (alerts inside dialogs). */
  doc?: boolean;
  id?: string;
  tabindex?: string;
  labelledby?: string;
}): JSX.Element {
  return (
    <div
      class={`alert alert-${props.kind}${props.doc === false ? "" : " doc-alert"}`}
      id={props.id}
      tabindex={props.tabindex}
      aria-labelledby={props.labelledby}
    >
      <span class="alert-icon">
        <Icon name={props.icon} />
      </span>
      <div class="alert-content">
        <Show when={props.title}>
          <p class="alert-title">{props.title}</p>
        </Show>
        <div class="alert-body">{props.children}</div>
      </div>
    </div>
  );
}

export function DocHeader(props: {
  backHref: string;
  backLabel: string;
  title: JSX.Element;
  badge: JSX.Element;
  subtitle?: JSX.Element;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <>
      <a class="link-subtle back-link" href={props.backHref}>
        <Icon name="arrow-left" size={18} />
        <span>{props.backLabel}</span>
      </a>
      <div class="page-header">
        <div>
          <div class="page-title-row">
            <h1 id="doc-title">{props.title}</h1>
            {props.badge}
          </div>
          <Show when={props.subtitle}>
            <p class="page-subtitle">{props.subtitle}</p>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="page-actions">{props.actions}</div>
        </Show>
      </div>
    </>
  );
}

export function MetaItem(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/** Sets document.title (after the shell's own title effect). */
export function useDocTitle(title: () => string): void {
  createEffect(() => {
    const t = `${title()} · Inventory Manager`;
    // queued after AppShell's own title effect
    queueMicrotask(() => (document.title = t));
  });
}

/** Mobile sticky action bar: `has-actionbar` on <main class="page"> and <body> (screens/receipt.html setChrome). */
export function useActionBarChrome(): void {
  onMount(() => {
    const main = document.getElementById("main");
    main?.classList.add("has-actionbar");
    document.body.classList.add("has-actionbar");
    onCleanup(() => {
      main?.classList.remove("has-actionbar");
      document.body.classList.remove("has-actionbar");
    });
  });
}
