// Vercel serverless function — returns public Supabase config from env vars.
// Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel → Project → Settings → Environment Variables.

export default function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY environment variable.'
    });
  }

  // Edge cache: config rarely changes, but stay snappy on cold starts.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ url, key });
}
