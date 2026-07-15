// TEMP DEBUG ROUTE — delete after diagnosing the vilao.ai 403.
// Calls the provider directly from Vercel's IP so we can see the raw response
// (AI SDK only surfaces "Forbidden" with no detail).
// GET /api/debug-vilao  -> { status, body }
// Optional query overrides: ?model=...&baseUrl=https://api.vilao.ai/v1
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const baseUrl = (q.baseUrl as string) || 'https://api.vilao.ai/v1'
  const model = (q.model as string) || 'ts/gemini-3.1-flash-lite'
  const key = process.env.VILAO_KEY

  if (!key) {
    return { status: 0, body: 'VILAO_KEY env not set on this deployment' }
  }

  const started = Date.now()
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 16,
      }),
    })
    const text = await res.text()
    return {
      status: res.status,
      ms: Date.now() - started,
      // echo a few response headers that often reveal WAF/IP blocks
      server: res.headers.get('server'),
      cfRay: res.headers.get('cf-ray'),
      body: text.slice(0, 800),
    }
  } catch (error) {
    return {
      status: -1,
      ms: Date.now() - started,
      body: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
})
