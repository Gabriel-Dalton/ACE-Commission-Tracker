// Local-dev fallback when /api/config isn't reachable (e.g. opening index.html
// directly in a browser without `vercel dev`). Copy to config.local.js (gitignored)
// and fill in your values. The deployed Vercel build ignores this file.

window.APP_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  key: 'sb_publishable_...'
};
