// Import this first in every script. It loads .env.local when the file exists.
// In GitHub Actions the values come from repository secrets instead.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local, rely on the real environment.
}

export {};
