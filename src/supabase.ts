import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False until the Supabase values are set in .env.local, so pages can show setup help. */
export const supabaseConfigured = Boolean(url && key);

// Placeholders keep the app from crashing on load when the values are missing.
export const supabase = createClient(url || "http://localhost:54321", key || "not-configured");
