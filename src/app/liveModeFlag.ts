// Live traffic is gated behind a build-time flag everywhere, including local dev.
// Set VITE_ENABLE_LIVE=true (e.g. in .env.local, or the deployment's env vars) to
// turn it on.
export const LIVE_MODE_ENABLED = import.meta.env.VITE_ENABLE_LIVE === 'true';
