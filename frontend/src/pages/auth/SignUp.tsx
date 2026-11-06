/** Sign up — screens/sign-up.html (states: default, validation, email taken; demo session note). */
import { Show, createSignal, onMount, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { loadMe, me, signUp } from "../../lib/auth";
import {
  AuthBrand,
  DEMO_LOADING_TEXT,
  EMAIL_RE,
  ErrorSummary,
  FieldError,
  FormAlert,
  PasswordToggle,
  demoErrorText,
  useStartDemo,
  type SummaryItem,
} from "./authShared";
import "./SignUp.css";

type FieldId = "email" | "password" | "confirm";
type Errors = Partial<Record<FieldId, string>>;
const FIELDS: FieldId[] = ["email", "password", "confirm"];
const LABELS: Record<FieldId, string> = { email: "Email", password: "Password", confirm: "Confirm password" };

export function signUpRules(v: { email: string; password: string; confirm: string }): Errors {
  const out: Errors = {};
  const em = v.email.trim();
  if (!em) out.email = "Enter your email address";
  else if (!EMAIL_RE.test(em)) out.email = "Enter a valid email address, like name@example.com";
  if (!v.password) out.password = "Create a password";
  else if (v.password.length < 8) out.password = "Password must be at least 8 characters";
  else if (v.password.length > 128) out.password = "Password must be at most 128 characters";
  if (!v.confirm) out.confirm = "Confirm your password";
  else if (v.confirm !== v.password) out.confirm = "Passwords don’t match";
  return out;
}

export default function SignUp(): JSX.Element {
  const navigate = useNavigate();
  const demo = useStartDemo();
  const [values, setValues] = createSignal({ email: "", password: "", confirm: "" });
  const [shown, setShown] = createSignal<Record<string, boolean>>({});
  const [errors, setErrors] = createSignal<Errors>({});
  const [summary, setSummary] = createSignal<SummaryItem[]>([]);
  const [alert, setAlert] = createSignal<"taken" | { title: string; body: string } | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const touched: Partial<Record<FieldId, boolean>> = {};
  let alertEl: HTMLDivElement | undefined;
  let summaryEl: HTMLDivElement | undefined;

  onMount(() => {
    document.title = "Create your account · Inventory Manager";
  });

  /** Signing up from a demo session ends the demo (the backend deletes it). */
  const inDemo = () => !!me()?.is_demo;
  const busy = () => submitting() || demo.pending();
  const check = (id: FieldId) => setErrors((e) => ({ ...e, [id]: signUpRules(values())[id] }));

  const onInput = (id: FieldId, value: string) => {
    setValues((v) => ({ ...v, [id]: value }));
    touched[id] = true;
    if (errors()[id]) check(id);
    if (id === "password" && touched.confirm && values().confirm) check("confirm");
  };
  const onBlur = (id: FieldId) => {
    if (touched[id]) check(id);
  };

  const showErrors = (errs: Errors) => {
    const items = FIELDS.filter((id) => errs[id]).map((id) => ({ id, msg: `${LABELS[id]}: ${errs[id]}` }));
    setErrors(errs);
    setSummary(items.length >= 2 ? items : []);
    queueMicrotask(() => {
      if (items.length >= 2) summaryEl?.focus();
      else if (items[0]) document.getElementById(items[0].id)?.focus();
    });
  };

  const showAlert = (a: "taken" | { title: string; body: string }) => {
    setSummary([]);
    setAlert(a);
    queueMicrotask(() => alertEl?.focus());
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    touched.email = touched.password = touched.confirm = true;
    setAlert(null);
    const errs = signUpRules(values());
    if (Object.keys(errs).length) {
      showErrors(errs);
      return;
    }
    setErrors({});
    setSummary([]);
    setSubmitting(true);
    try {
      await signUp({ email: values().email.trim(), password: values().password });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "email_taken") {
        setErrors({ email: "This email is already registered" });
        showAlert("taken");
      } else if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) {
        const fe = err.fieldErrors();
        const mapped: Errors = {};
        for (const id of FIELDS) if (fe[id]) mapped[id] = fe[id];
        if (Object.keys(mapped).length) showErrors(mapped);
        else showAlert({ title: "Couldn’t create your account", body: err.message });
      } else {
        showAlert({ title: "Couldn’t create your account", body: demoErrorText(err) });
      }
      return;
    }
    navigate("/dashboard", { replace: true });
    void loadMe(true).catch(() => undefined);
  };

  const tryDemo = async (e: MouseEvent) => {
    e.preventDefault();
    setAlert(null);
    const ok = await demo.start();
    if (!ok && demo.error()) showAlert({ title: "Couldn’t start a demo", body: demo.error()! });
  };

  const fieldClass = (id: FieldId) => `field${errors()[id] ? " is-invalid" : ""}`;
  const toggle = (id: FieldId) => setShown((s) => ({ ...s, [id]: !s[id] }));

  const passwordField = (id: "password" | "confirm", label: string, extra?: JSX.Element) => (
    <div class={fieldClass(id)}>
      <label for={id}>{label}</label>
      <div class="input-group">
        <input
          class="input"
          id={id}
          name={id}
          type={shown()[id] ? "text" : "password"}
          autocomplete="new-password"
          aria-describedby={id === "password" ? "password-hint password-error" : "confirm-error"}
          aria-invalid={errors()[id] ? "true" : undefined}
          value={values()[id]}
          onInput={(e) => onInput(id, e.currentTarget.value)}
          onBlur={() => onBlur(id)}
        />
        <PasswordToggle
          controls={id}
          shown={!!shown()[id]}
          onToggle={() => toggle(id)}
          disabled={busy()}
          srLabel={id === "confirm" ? "confirm password" : "password"}
        />
      </div>
      {extra}
      <FieldError id={`${id}-error`} message={errors()[id]} />
    </div>
  );

  return (
    <main id="main" class="auth-layout" data-page="sign-up" tabindex="-1">
      <AuthBrand />

      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-head">
          <h1 class="auth-title" id="auth-title">
            Create your account
          </h1>
          <p class="auth-sub">Your own private stock workspace. Free to start.</p>
        </div>

        <Show when={inDemo()}>
          <div class="alert alert-info" id="demo-ends-note">
            <span class="alert-icon">
              <Icon name="info" size={20} />
            </span>
            <div class="alert-content">
              <p class="alert-title">You’re in a demo</p>
              <p class="alert-body">
                Creating an account ends it: the demo workspace and all its data are deleted. Nothing is transferred.
              </p>
            </div>
          </div>
        </Show>

        <div id="form-messages" aria-live="assertive">
          <Show when={summary().length >= 2}>
            <ErrorSummary
              ref={(el) => (summaryEl = el)}
              title={`Fix ${summary().length} problems to create your account`}
              items={summary()}
            />
          </Show>
          <Show when={alert() === "taken"}>
            <FormAlert ref={(el) => (alertEl = el)} class="form-alert" id="taken-alert" title="Email already in use">
              An account with this email already exists.{" "}
              <Show when={!inDemo()} fallback={<>Use a different email.</>}>
                <a class="link" href="/sign-in">
                  Sign in instead?
                </a>
              </Show>
            </FormAlert>
          </Show>
          <Show when={(() => { const a = alert(); return a && a !== "taken" ? a : null; })()}>
            {(a) => (
              <FormAlert ref={(el) => (alertEl = el)} class="form-alert" id="form-alert" title={a().title}>
                {a().body}
              </FormAlert>
            )}
          </Show>
        </div>

        <form id="sign-up-form" class="auth-form" novalidate onSubmit={submit}>
          <fieldset id="sign-up-fields" disabled={busy()}>
            <legend class="visually-hidden">Create an account with email and password</legend>

            <div class={fieldClass("email")}>
              <label for="email">Email</label>
              <input
                class="input"
                id="email"
                name="email"
                type="email"
                autocomplete="email"
                inputmode="email"
                spellcheck={false}
                aria-describedby="email-error"
                aria-invalid={errors().email ? "true" : undefined}
                value={values().email}
                onInput={(e) => onInput("email", e.currentTarget.value)}
                onBlur={() => onBlur("email")}
              />
              <FieldError id="email-error" message={errors().email} />
            </div>

            {passwordField(
              "password",
              "Password",
              <p class="hint" id="password-hint">
                At least 8 characters
              </p>,
            )}
            {passwordField("confirm", "Confirm password")}

            <button
              type="submit"
              class={`btn btn-primary btn-block auth-submit${submitting() ? " is-loading" : ""}`}
              id="sign-up-btn"
              aria-busy={submitting() ? "true" : undefined}
            >
              <span>Create account</span>
            </button>
            <p class="muted text-sm" id="empty-workspace-note">
              Your new account starts with an empty workspace. Demo data isn’t transferred.
            </p>
          </fieldset>
        </form>

        <div class="auth-footer">
          <Show
            when={!inDemo()}
            fallback={
              <p>
                Not ready yet?{" "}
                <a class="link" href="/dashboard">
                  Back to the demo
                </a>
              </p>
            }
          >
            <p>
              Already have an account?{" "}
              <a class="link" href="/sign-in">
                Sign in
              </a>
            </p>
            <p>
              Just looking around?{" "}
              <a
                class="link"
                href="/dashboard"
                id="demo-link"
                aria-busy={demo.pending() ? "true" : undefined}
                onClick={tryDemo}
              >
                {demo.pending() ? DEMO_LOADING_TEXT : "Try demo instead"}
              </a>
            </p>
          </Show>
        </div>

        <p class="visually-hidden" role="status" id="status-msg">
          {submitting() ? "Creating your account…" : demo.pending() ? DEMO_LOADING_TEXT : ""}
        </p>
      </section>
    </main>
  );
}
