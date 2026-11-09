export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "workday";

/** A job in the same shape no matter which hiring platform it came from. */
export interface NormalizedJob {
  externalId: string;
  title: string;
  location: string;
  department: string | null;
  isRemote: boolean;
  applyUrl: string;
  postedAt: string | null;
}

export interface AtsAdapter {
  type: AtsType;
  fetchJobs(token: string): Promise<NormalizedJob[]>;
}

export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  careers_url: string;
  segment: string;
  ats: AtsType | null;
  ats_token: string | null;
  baseline_done: boolean;
  active: boolean;
}

export interface JobRow {
  id: string;
  company_id: string;
  external_id: string;
  title: string;
  location: string;
  department: string | null;
  is_remote: boolean;
  apply_url: string;
  posted_at: string | null;
  first_seen_at: string;
  active: boolean;
  is_baseline: boolean;
}

export interface JobWithCompany extends JobRow {
  companies: { name: string; slug: string; segment: string };
}

export interface AlertRow {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  exclude_keywords: string[];
  locations: string[];
  segments: string[];
  remote_only: boolean;
  channels: string[];
  active: boolean;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  telegram_chat_id: number | null;
  telegram_link_code: string;
  whatsapp_number: string | null;
  whatsapp_link_code: string;
}
