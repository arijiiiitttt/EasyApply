import { getJson } from "../http";
import type { AtsAdapter, NormalizedJob } from "../types";

/**
 * Workday token format: "tenant|wdN|site", for example "nvidia|wd5|NVIDIAExternalCareerSite".
 * It comes from the careers URL: https://tenant.wdN.myworkdayjobs.com/site
 */
interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

const PAGE = 20;
const MAX_JOBS = 600;

export const workday: AtsAdapter = {
  type: "workday",
  async fetchJobs(token) {
    const [tenant, dc, site] = token.split("|");
    if (!tenant || !dc || !site) {
      throw new Error(`Bad Workday token "${token}", expected tenant|wdN|site`);
    }
    const host = `${tenant}.${dc}.myworkdayjobs.com`;
    const jobs: NormalizedJob[] = [];
    let offset = 0;
    while (offset < MAX_JOBS) {
      const data = await getJson<WorkdayResponse>(
        `https://${host}/wday/cxs/${tenant}/${site}/jobs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The search text keeps big employers to roughly their India roles.
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE,
            offset,
            searchText: "India",
          }),
        },
      );
      const postings = data.jobPostings ?? [];
      for (const p of postings) {
        const location = p.locationsText ?? "";
        jobs.push({
          externalId: p.bulletFields?.[0] ?? p.externalPath,
          title: p.title,
          location,
          department: null,
          isRemote: /remote/i.test(location),
          applyUrl: `https://${host}/en-US/${site}${p.externalPath}`,
          postedAt: null,
        });
      }
      offset += PAGE;
      if (postings.length < PAGE || offset >= (data.total ?? 0)) break;
    }
    return jobs;
  },
};
