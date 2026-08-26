import { requestMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <main className="centered">
      <section className="panel">
        <p className="eyebrow">Whetstone OS</p>
        <h1>Sign in</h1>
        <p>
          Use your approved email address. We will send a secure sign-in link.
        </p>
        <form action={requestMagicLink}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <button type="submit">Email me a sign-in link</button>
        </form>
        {query.sent === "1" && (
          <p role="status">Check your inbox for the sign-in link.</p>
        )}
        {query.error && (
          <p role="alert">We could not complete sign-in. Try again.</p>
        )}
      </section>
    </main>
  );
}
