// Piped API CORS Proxy
//
// Only forwards GET requests to an allowlist of Piped API instances,
// and adds CORS headers only for the origins of the Piped PWA deployment
// and local development.
//
// Deploy: cd cors-worker && wrangler deploy
// Then point VITE_CORS_PROXY_URL in the PWA .env at the Worker URL.

// Allowed Piped API instance hosts (add more here as needed)
const ALLOWED_HOSTS = new Set([
  "pipedapi.kavin.rocks",
  "pipedapi.adminforge.de",
  "pipedapi.ducks.party",
  "pipedapi.privacy.com.de",
]);

// Allowed origins (production PWA + local dev server)
const ALLOWED_ORIGINS = new Set([
  "https://rbyers87.github.io",
  "http://localhost:5173",
]);

function allowedCORSOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return origin;
}

function corsHeaders(origin) {
  const headers = new Headers();
  if (origin) {
    // Echo back only verified origins; never use "*" since we expose
    // headers and may carry cookies/credentials.
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export default {
  async fetch(request, env, ctx) {
    // --- Preflight -------------------------------------------------
    if (request.method === "OPTIONS") {
      const origin = allowedCORSOrigin(request);
      const headers = corsHeaders(origin);
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Access-Control-Max-Age", "86400");
      // No origin allowed -> 204 with no Access-Control-Allow-Origin,
      // so the browser rejects the preflight (as it should).
      return new Response(null, { status: 204, headers });
    }

    // --- Method restriction ----------------------------------------
    if (request.method !== "GET") {
      return new Response("Method not allowed. Only GET is supported.", {
        status: 405,
        headers: corsHeaders(allowedCORSOrigin(request)),
      });
    }

    // --- Parse target URL: ?u=<encoded full URL> -------------------
    let targetUrl;
    try {
      const url = new URL(request.url);
      const u = url.searchParams.get("u");
      if (!u) {
        return new Response("Missing 'u' query parameter.", {
          status: 400,
          headers: corsHeaders(allowedCORSOrigin(request)),
        });
      }
      targetUrl = new URL(u); // throws if malformed
    } catch {
      return new Response("Invalid target URL.", {
        status: 400,
        headers: corsHeaders(allowedCORSOrigin(request)),
      });
    }

    // Protocol restriction: https only, to prevent SSRF to local http.
    if (targetUrl.protocol !== "https:") {
      return new Response("Only https targets are allowed.", {
        status: 400,
        headers: corsHeaders(allowedCORSOrigin(request)),
      });
    }

    // --- Host allowlist --------------------------------------------
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      console.warn(`Blocked request to disallowed host: ${targetUrl.hostname}`);
      return new Response(
        `Host not allowed: ${targetUrl.hostname}. Only Piped API instances are supported.`,
        { status: 403, headers: corsHeaders(allowedCORSOrigin(request)) }
      );
    }

    // --- Forward the request with a timeout so a dead upstream
    // --- can't hang the worker (and the PWA) indefinitely.
    const controller = new AbortController();
    const timeoutMs = 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err?.name === "AbortError";
      console.error(`Forwarded request ${aborted ? "timed out" : "failed"}: ${targetUrl.href}`, err);
      return new Response(aborted ? "Upstream request timed out." : "Upstream request failed.", {
        status: aborted ? 504 : 502,
        headers: corsHeaders(allowedCORSOrigin(request)),
      });
    }
    clearTimeout(timer);

    // --- Copy upstream body back, adding CORS for allowed origins.
    // We deliberately do NOT forward upstream auth cookies: the PWA
    // relies on its own token, and keeping this a dumb GET pipe is the
    // whole point of the allowlist.
    const origin = allowedCORSOrigin(request);
    const headers = corsHeaders(origin);
    headers.set("Access-Control-Expose-Headers", "Content-Type");
    if (upstream.headers.get("Content-Type")) {
      headers.set("Content-Type", upstream.headers.get("Content-Type"));
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
