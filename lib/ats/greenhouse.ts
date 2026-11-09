import { getJson } from "../http";
import type { AtsAdapter } from "../types";

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
}

export const greenhouse: AtsAdapter = {
  type: "greenhouse",
  async fetchJobs(token) {
    const data = await getJson<{ jobs?: GreenhouseJob[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
    );
    return (data.jobs ?? []).map((j) => {
      const location = j.location?.name ?? "";
      return {
        externalId: String(j.id),
        title: j.title,
        location,
        department: null,
        isRemote: /remote/i.test(location),
        applyUrl: j.absolute_url,
        postedAt: j.first_published ?? j.updated_at ?? null,
      };
    });
  },
};

/** The display name of a Greenhouse board, used to double-check guessed tokens. */
export async function greenhouseBoardName(token: string): Promise<string | null> {
  try {
    const data = await getJson<{ name?: string }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`,
    );
    return data.name ?? null;
  } catch {
    return null;
  }
}
