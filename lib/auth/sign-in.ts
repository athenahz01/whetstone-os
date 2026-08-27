/**
 * Password sign-in, as a pure core.
 *
 * The magic link put email deliverability between the owner and her own
 * dashboard, and on a phone it meant leaving the app, opening a mail client,
 * tapping a link and coming back. This replaces it.
 *
 * The Supabase call is injected rather than imported so the whole decision can
 * be exercised without `next/headers`, which is what makes the two assertions
 * that matter testable: that both failures produce the identical message, and
 * that the password reaches nothing except the credential call.
 */

export type SignInNotice = "credentials" | "signed-out" | null;

/**
 * One message for a bad password and one for an unknown address.
 *
 * Two messages would turn the form into an oracle for which addresses have
 * accounts. This constant is the only error text the login page renders, so
 * they cannot drift apart.
 */
export const SIGN_IN_ERROR_MESSAGE =
  "We could not sign you in with those details. Check them and try again.";

export const SIGNED_OUT_MESSAGE = "You are signed out.";

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignInResult {
  ok: boolean;
}

export interface AuthenticateInput extends SignInCredentials {
  signIn: (credentials: SignInCredentials) => Promise<SignInResult>;
}

export interface AuthenticateOutcome {
  redirectTo: string;
}

export const SIGN_IN_SUCCESS_PATH = "/today";
export const SIGN_IN_FAILURE_PATH = "/login?error=credentials";
export const SIGN_OUT_PATH = "/login?signedOut=1";

/**
 * Returns where to send the browser, and nothing else.
 *
 * Every failure returns the same path, including a missing field and a thrown
 * transport error, so the URL carries no signal about which half was wrong and
 * no fragment of a provider message. The password appears in exactly one place
 * in this function: the argument to `signIn`.
 */
export async function authenticate(
  input: AuthenticateInput,
): Promise<AuthenticateOutcome> {
  const email = input.email.trim();
  const password = input.password;
  if (!email || !password) return { redirectTo: SIGN_IN_FAILURE_PATH };

  try {
    const result = await input.signIn({ email, password });
    return {
      redirectTo: result.ok ? SIGN_IN_SUCCESS_PATH : SIGN_IN_FAILURE_PATH,
    };
  } catch {
    // A transport failure is still a failed sign-in. The thrown value is
    // deliberately not read: it is the one object that could carry the request
    // body back out into a redirect or a log line.
    return { redirectTo: SIGN_IN_FAILURE_PATH };
  }
}

/** The notice the login page renders, derived only from the query string. */
export function readSignInNotice(
  query: Record<string, string | string[] | undefined>,
): SignInNotice {
  if (query.error) return "credentials";
  if (query.signedOut) return "signed-out";
  return null;
}

export function signInNoticeMessage(notice: SignInNotice): string | null {
  if (notice === "credentials") return SIGN_IN_ERROR_MESSAGE;
  if (notice === "signed-out") return SIGNED_OUT_MESSAGE;
  return null;
}
