/**
 * Run a Netlify function inside a Worker.
 *
 * Netlify hands a function `(event, context)` and expects
 * `{statusCode, headers, body, isBase64Encoded}` back. A Worker deals in
 * Request and Response. This is the whole of the difference, so the function
 * sources are ported by importing them, not by rewriting them -- which is the
 * point: the metadata these endpoints serve is referenced from NFT metadata,
 * and a reimplementation is a chance to change an answer by accident.
 */
export async function runNetlifyFunction (handler, request, { path } = {}) {
  const url = new URL(request.url)
  const event = {
    path: path ?? url.pathname,
    rawUrl: request.url,
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers),
    // Netlify always supplies an object here, never null, and the folia
    // functions read `.network` off it without guarding.
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: ['GET', 'HEAD'].includes(request.method) ? null : await request.text(),
    isBase64Encoded: false
  }

  const res = await handler(event, {})
  const body = res.isBase64Encoded ? base64ToBytes(res.body) : res.body
  return new Response(body, {
    status: res.statusCode ?? 200,
    headers: res.headers ?? {}
  })
}

function base64ToBytes (b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
