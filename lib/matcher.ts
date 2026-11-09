import type { AlertRow, JobWithCompany } from "./types";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match, so "react" does not match "reactive". Plurals are allowed. */
function hasToken(text: string, token: string): boolean {
  const t = token.toLowerCase();
  const plural = /^[a-z]{3,}$/.test(t) ? "s?" : "";
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}${plural}($|[^a-z0-9])`).test(text);
}

/** Every word of the phrase must appear, in any order. */
function hasPhrase(text: string, phrase: string): boolean {
  const tokens = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => hasToken(text, t));
}

/**
 * Does this job match this alert?
 * - at least one keyword phrase matches the title or department
 * - no exclude phrase matches
 * - location, remote and company-group filters pass when they are set
 */
export function matchesAlert(alert: AlertRow, job: JobWithCompany): boolean {
  const text = `${job.title} ${job.department ?? ""}`.toLowerCase();

  if (!alert.keywords.some((k) => hasPhrase(text, k))) return false;
  if (alert.exclude_keywords.some((k) => hasPhrase(text, k))) return false;

  if (alert.remote_only && !job.is_remote) return false;

  if (alert.locations.length > 0) {
    const loc = job.location.toLowerCase();
    if (!alert.locations.some((l) => loc.includes(l.toLowerCase()))) return false;
  }

  if (alert.segments.length > 0 && !alert.segments.includes(job.companies.segment)) {
    return false;
  }

  return true;
}
