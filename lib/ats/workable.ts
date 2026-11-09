import { getJson } from "../http";
import type { AtsAdapter } from "../types";

interface WorkableJob {
  title: string;
  shortcode: string;
  department?: string;
  city?: string;
  state?: string;
  country?: string;
  telecommuting?: boolean;
  url?: string;
  application_url?: string;
  published_on?: string;
}

export const workable: AtsAdapter = {
  type: "workable",
  async fetchJobs(token) {
    const data = await getJson<{ jobs?: WorkableJob[] }>(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`,
    );
    return (data.jobs ?? []).map((j) => ({
      externalId: j.shortcode,
      title: j.title,
      location: [j.city, j.state, j.country].filter(Boolean).join(", "),
      department: j.department ?? null,
      isRemote: Boolean(j.telecommuting),
      applyUrl: j.url ?? j.application_url ?? "",
      postedAt: j.published_on ?? null,
    }));
  },
};
