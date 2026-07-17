import { data, Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  clearDispatchSessionCookie,
  createDispatchLoginSession,
  getCurrentDispatchUser,
} from "../lib/auth.server";

function safeRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("logout") === "1") {
    return redirect("/login", {
      headers: { "Set-Cookie": clearDispatchSessionCookie() },
    });
  }

  const current = await getCurrentDispatchUser(request);
  const next = safeRedirect(url.searchParams.get("next"));
  if (current) return redirect(next);
  return data({ next });
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const next = safeRedirect(String(form.get("next") || "/"));

  if (!email || !password) {
    return data({ ok: false, message: "Email and password are required." }, { status: 400 });
  }

  return createDispatchLoginSession({ email, password, redirectTo: next });
}

export default function Login() {
  const { next } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();

  return (
    <main className="loginPage">
      <section className="panel loginPanel">
        <p className="eyebrow">Dispatch v2</p>
        <h1>Sign in</h1>
        <p className="muted">
          Use your existing Supabase account. No new email or password needed.
        </p>
        <Form method="post" className="settingsForm">
          <input type="hidden" name="next" value={next} />
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {actionData?.message ? <div className="notice error">{actionData.message}</div> : null}
          <button type="submit" className="primaryButton" disabled={navigation.state !== "idle"}>
            {navigation.state !== "idle" ? "Signing in..." : "Sign In"}
          </button>
        </Form>
      </section>
    </main>
  );
}
