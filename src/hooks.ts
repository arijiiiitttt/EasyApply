import { useCallback, useEffect, useState } from "react";

/** Runs an async loader when `key` changes. Ignores answers that arrive out of order. */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const run = useCallback(load, [key, tick]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    run()
      .then((result) => {
        if (!current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [run]);

  return { data, error, loading, reload: () => setTick((n) => n + 1) };
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Easy Apply` : "Easy Apply";
  }, [title]);
}
