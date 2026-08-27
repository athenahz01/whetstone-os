import { redirect } from "next/navigation";
import { prisma } from "../../lib/core/db";
import { WHETSTONE_ORG_ID } from "../../lib/core/organization";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const leads = await prisma.lead.findMany({
    where: { orgId: WHETSTONE_ORG_ID },
    select: {
      id: true,
      channel: true,
      subject: true,
      location: true,
      score: true,
      url: true,
    },
    orderBy: { postedAt: "desc" },
    take: 25,
  });
  return (
    <main className="shell">
      <div className="row">
        <p className="eyebrow">Whetstone OS</p>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
      <h1>Today</h1>
      <p>
        Review each opportunity here. Sending always requires a human action.
      </p>
      <div className="leadList">
        {leads.length === 0 && (
          <p className="panel">No opportunities are waiting.</p>
        )}
        {leads.map((lead) => (
          <article className="panel" key={lead.id}>
            <div className="row">
              <strong>{lead.subject ?? "New opportunity"}</strong>
              <span>{lead.score}</span>
            </div>
            <p>
              {lead.location ?? "Location not provided"} · {lead.channel}
            </p>
            <a href={lead.url} target="_blank" rel="noreferrer">
              Open source and review
            </a>
          </article>
        ))}
      </div>
    </main>
  );
}
