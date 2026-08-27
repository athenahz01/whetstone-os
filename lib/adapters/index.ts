import { createEmailAdapterFromEnv } from "./email";
import type { ChannelAdapter } from "../core/types";

export { CounselorsAdapter } from "./counselors";
export { ReengagementAdapter } from "./reengagement";
export { ReferralsAdapter } from "./referrals";

export function createScheduledAdapters(): ChannelAdapter[] {
  const adapters: ChannelAdapter[] = [];
  const email = createEmailAdapterFromEnv();
  if (email) adapters.push(email);
  else
    console.warn("Email ingest is disabled: IMAP credentials are incomplete.");
  return adapters;
}
