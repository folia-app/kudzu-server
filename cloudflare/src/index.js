/**
 * virus.folia.app as a Worker.
 *
 * netlify.toml:
 *   /metadata/*  -> the metadata function
 *   /img/*       -> https://folia-kudzu-img.fly.dev/img/:splat  (force = true)
 *   publish      -> public/, with no build step
 *
 * /.netlify/functions/metadata/* is served as well, because www.folia.app's
 * own metadata lambda fetches this site at exactly that path when it does not
 * recognise a token id. That url is reached from published NFT metadata, so it
 * has to keep answering.
 *
 * The image route is a proxy, not a redirect: those urls are in NFT metadata
 * too, and a 301 would change what consumers see.
 */
import metadataFn from '../../netlify/functions/metadata'
import { runNetlifyFunction } from './netlify'

const IMG_ORIGIN = 'https://folia-kudzu-img.fly.dev'

export default {
  async fetch (request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/metadata/') || url.pathname.startsWith('/.netlify/functions/metadata/')) {
      return runNetlifyFunction(metadataFn.handler, request, { path: url.pathname })
    }

    if (url.pathname.startsWith('/img/')) {
      const upstream = await fetch(IMG_ORIGIN + url.pathname + url.search, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow'
      })
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers })
    }

    let res = await asset(env, request, url.pathname)
    if (res.status === 404 && url.pathname.endsWith('/')) {
      const idx = await asset(env, request, url.pathname + 'index.html')
      if (idx.status !== 404) res = idx
    }
    if (res.status === 404 && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      const withExt = await asset(env, request, url.pathname.replace(/\/$/, '') + '.html')
      if (withExt.status !== 404) res = withExt
    }
    return res
  }
}

function asset (env, request, pathname) {
  const u = new URL(request.url)
  u.pathname = pathname
  u.search = ''
  return env.ASSETS.fetch(new Request(u, { method: request.method, headers: request.headers }))
}
