import { getJson } from "../http";
import type { AtsAdapter } from "../types";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  isRemote?: boolean;
  isListed?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
}

export const ashby: AtsAdapter = {
  type: "ashby",
  async fetchJobs(token) {
    const data = await getJson<{ jobs?: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
    );
    return (data.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j) => {
        const locations = [
          j.location,
          ...(j.secondaryLocations ?? []).map((s) => s.location),
        ].filter((l): l is string => Boolean(l));
        return {
          externalId: j.id,
          title: j.title,
          location: locations.join(" / "),
          department: j.department ?? j.team ?? null,
          isRemote: Boolean(j.isRemote),
          applyUrl: j.jobUrl ?? j.applyUrl ?? "",
          postedAt: j.publishedAt ?? null,
        };
      });
  },
};
