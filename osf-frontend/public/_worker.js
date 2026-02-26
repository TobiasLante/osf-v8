/**
 * Cloudflare Pages Advanced Mode Worker
 *
 * Handles SPA routing for dynamic routes. Runs BEFORE static asset serving,
 * eliminating Cloudflare Pages' 308 redirect behavior completely.
 *
 * To add a new dynamic route: add an entry to DYNAMIC_ROUTES below.
 */

const DYNAMIC_ROUTES = [
  // /flows/:id → serve the flow detail page (but NOT /flows/editor)
  { pattern: /^\/flows\/(?!editor$)[^/]+$/, fallback: '/flows/placeholder.html' },
  // /agents/code/:id → serve the code agent detail page (but NOT /agents/code/new)
  { pattern: /^\/agents\/code\/(?!new$)[^/]+$/, fallback: '/agents/code/placeholder.html' },
  // /agents/:id → serve the agent detail page (for DB-only agents like forks)
  { pattern: /^\/agents\/(?!code$|chains$)[^/]+$/, fallback: '/agents/placeholder.html' },
  // /chains/:id → serve the chain detail page (for DB-only chains like forks)
  { pattern: /^\/chains\/(?!create$)[^/]+$/, fallback: '/chains/placeholder.html' },
];

async function fetchAsset(request, env, pathname) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  let response = await env.ASSETS.fetch(new Request(assetUrl, request));

  // If env.ASSETS returns a redirect (CF pretty-URLs), follow it internally
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      const followUrl = new URL(location, request.url);
      response = await env.ASSETS.fetch(new Request(followUrl, request));
    }
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if this is a dynamic route that needs SPA fallback
    for (const route of DYNAMIC_ROUTES) {
      if (route.pattern.test(path)) {
        const response = await fetchAsset(request, env, route.fallback);
        const headers = new Headers(response.headers);
        headers.delete('X-OSF-Worker');
        return new Response(response.body, { status: 200, headers });
      }
    }

    // For all other requests, try serving the asset directly first
    let response = await env.ASSETS.fetch(request);

    // If we get a 404 and path has no extension, try appending .html
    // This handles the case where CF pretty-URLs redirect .html→non-.html
    // but then the non-.html path doesn't resolve in advanced mode
    if (response.status === 404 && !path.includes('.') && path !== '/') {
      const htmlResponse = await fetchAsset(request, env, path + '.html');
      if (htmlResponse.status === 200) {
        response = htmlResponse;
      }
    }

    // If we get a redirect (e.g., .html → non-.html), follow it internally
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        const followUrl = new URL(location, request.url);
        let followed = await env.ASSETS.fetch(new Request(followUrl, request));
        // If the followed redirect also 404s, try .html fallback
        if (followed.status === 404) {
          const followPath = followUrl.pathname;
          if (!followPath.includes('.') && followPath !== '/') {
            const htmlFallback = await fetchAsset(request, env, followPath + '.html');
            if (htmlFallback.status === 200) {
              followed = htmlFallback;
            }
          }
        }
        response = followed;
      }
    }

    const headers = new Headers(response.headers);
    headers.delete('X-OSF-Worker');
    return new Response(response.body, { status: response.status, headers });
  }
};
