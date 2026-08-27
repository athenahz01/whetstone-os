"use server";

import { redirect } from "next/navigation";
import { authenticate, SIGN_OUT_PATH } from "../../lib/auth/sign-in";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export async function signInWithPassword(formData: FormData) {
  const outcome = await authenticate({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    signIn: async (credentials) => {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signInWithPassword(credentials);
      return { ok: !error };
    },
  });
  redirect(outcome.redirectTo);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  // Global scope revokes the refresh token at Supabase, so the session is dead
  // server side rather than merely absent from this browser. Clearing a cookie
  // alone would leave a token a client could put back.
  await supabase.auth.signOut({ scope: "global" });
  redirect(SIGN_OUT_PATH);
}
