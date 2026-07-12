/** Full-screen loading/error overlay driven by the bootstrap state. */
export function LoadingOverlay({ message, error }: { message: string | null; error: Error | null }) {
  return <div className={`loading ${!message && !error ? 'hidden' : ''}`}>{error?.message ?? message}</div>;
}
