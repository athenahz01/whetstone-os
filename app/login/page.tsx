import { readSignInNotice, signInNoticeMessage } from "../../lib/auth/sign-in";
import { signInWithPassword } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const notice = readSignInNotice(query);
  // The only error text on this page comes from one function, so a bad password
  // and an unknown address cannot drift into two different messages.
  const message = signInNoticeMessage(notice);
  return (
    <main className="centered">
      <section className="panel">
        <p className="eyebrow">Whetstone OS</p>
        <h1>Sign in</h1>
        <p>Use your approved email address and password.</p>
        <form action={signInWithPassword}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <button type="submit">Sign in</button>
        </form>
        {message && (
          <p role={notice === "credentials" ? "alert" : "status"}>{message}</p>
        )}
      </section>
    </main>
  );
}
