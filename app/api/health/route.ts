import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    services: {
      database: Boolean(process.env.DATABASE_URL),
      authentication: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      drafting: Boolean(process.env.ANTHROPIC_API_KEY),
      alerts: Boolean(
        process.env.ALERT_SMTP_HOST && process.env.ALERT_EMAIL_TO,
      ),
      email: Boolean(
        process.env.EMAIL_IMAP_HOST && process.env.EMAIL_IMAP_USER,
      ),
    },
  });
}
