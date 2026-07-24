// Live traffic is still rough enough that we gate it behind a build-time flag for
// hosted deployments (e.g. Vercel), while keeping it available in local dev by
// default. Set VITE_ENABLE_LIVE=true in the deployment environment to turn it on.
export const LIVE_MODE_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIVE === 'true';
