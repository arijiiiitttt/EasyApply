export function Loading() {
  return (
    <p className="muted" role="status">
      Loading
    </p>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice" role="alert">
      <strong>Could not load this page.</strong> {message}{" "}
      {onRetry && (
        <button type="button" className="btn small" onClick={onRetry} style={{ marginLeft: 8 }}>
          Try again
        </button>
      )}
    </div>
  );
}
