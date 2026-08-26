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
      telegram: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
      ),
      email: Boolean(
        process.env.EMAIL_IMAP_HOST && process.env.EMAIL_IMAP_USER,
      ),
    },
  });
}
