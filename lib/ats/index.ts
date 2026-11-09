import type { AtsAdapter, AtsType } from "../types";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import { workable } from "./workable";
import { workday } from "./workday";

export const adapters: Record<AtsType, AtsAdapter> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  workday,
};

export const ATS_TYPES = Object.keys(adapters) as AtsType[];

const GREENHOUSE_IGNORED = new Set(["embed", "v1", "jobs", "boards", "api"]);

/**
 * Finds a hiring platform link inside a URL or a chunk of page HTML,
 * such as a careers page that embeds a Greenhouse or Lever board.
 */
export function detectFromText(
  text: string,
): { ats: AtsType; token: string } | null {
  const workdayMatch = text.match(
    /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
  );
  if (workdayMatch) {
    return {
      ats: "workday",
      token: `${workdayMatch[1]}|${workdayMatch[2]}|${workdayMatch[3]}`,
    };
  }

  const greenhouseMatch = text.match(
    /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i,
  );
  if (greenhouseMatch && !GREENHOUSE_IGNORED.has(greenhouseMatch[1].toLowerCase())) {
    return { ats: "greenhouse", token: greenhouseMatch[1] };
  }

  const leverMatch = text.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i);
  if (leverMatch) return { ats: "lever", token: leverMatch[1] };

  const ashbyMatch = text.match(/jobs\.ashbyhq\.com\/([a-z0-9._-]+)/i);
  if (ashbyMatch) return { ats: "ashby", token: ashbyMatch[1] };

  const smartMatch = text.match(
    /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/,
  );
  if (smartMatch) return { ats: "smartrecruiters", token: smartMatch[1] };

  const workableMatch = text.match(/apply\.workable\.com\/([a-z0-9_-]+)/i);
  if (workableMatch && workableMatch[1].toLowerCase() !== "api") {
    return { ats: "workable", token: workableMatch[1] };
  }

  return null;
}
