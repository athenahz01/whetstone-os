"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=email");
  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: siteUrl
      ? { emailRedirectTo: `${siteUrl}/auth/confirm` }
      : undefined,
  });
  if (error) redirect("/login?error=send");
  redirect("/login?sent=1");
}
