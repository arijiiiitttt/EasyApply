import { getJson } from "../http";
import type { AtsAdapter } from "../types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: {
    location?: string;
    allLocations?: string[];
    team?: string;
    department?: string;
  };
}

export const lever: AtsAdapter = {
  type: "lever",
  async fetchJobs(token) {
    const data = await getJson<LeverPosting[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
    );
    return (Array.isArray(data) ? data : []).map((p) => {
      const locations = p.categories?.allLocations?.length
        ? p.categories.allLocations
        : p.categories?.location
          ? [p.categories.location]
          : [];
      const location = locations.join(" / ");
      return {
        externalId: p.id,
        title: p.text,
        location,
        department: p.categories?.team ?? p.categories?.department ?? null,
        isRemote: p.workplaceType === "remote" || /remote/i.test(location),
        applyUrl: p.hostedUrl ?? p.applyUrl ?? "",
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      };
    });
  },
};
