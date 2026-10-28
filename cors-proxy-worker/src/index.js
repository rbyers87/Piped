/**
 * Cloudflare Worker — lightweight CORS proxy for Piped PWA.
 *
 * Accepts:  GET /?u=<encoded-target-url>
 * Returns:  The upstream response with permissive CORS headers.
 *
 * Security: Only proxies to hosts in ALLOWED_HOSTS so it can't be
 *           abused as an open relay.
 */

const ALLOWED_HOSTS = [
    "pipedapi.adminforge.de",
    "pipedapi.privacy.com.de",
    "pipedapi.kavin.rocks",
    "pipedapi.ducks.party",
    "piped-instances.kavin.rocks",
    "pipedapi.leptons.xyz",
    "api.piped.projectsegfau.lt",
    "pipedapi.in.projectsegfau.lt",
    "pipedapi.us.projectsegfau.lt",
];

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(request) });
        }

        const url = new URL(request.url);
        const target = url.searchParams.get("u");

        if (!target) {
            return new Response(JSON.stringify({ error: "Missing ?u= parameter" }), {
                status: 400,
                headers: { ...corsHeaders(request), "Content-Type": "application/json" },
            });
        }

        let targetUrl;
        try {
            targetUrl = new URL(target);
        } catch {
            return new Response(JSON.stringify({ error: "Invalid URL in ?u= parameter" }), {
                status: 400,
                headers: { ...corsHeaders(request), "Content-Type": "application/json" },
            });
        }

        // Block requests to hosts not in the allowlist
        if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
            return new Response(JSON.stringify({ error: `Host not allowed: ${targetUrl.hostname}` }), {
                status: 403,
                headers: { ...corsHeaders(request), "Content-Type": "application/json" },
            });
        }

        try {
            // Strip hop-by-hop headers, forward the rest
            const headers = new Headers();
            for (const [key, value] of request.headers) {
                const lower = key.toLowerCase();
                if (
                    lower === "host" ||
                    lower === "origin" ||
                    lower === "referer" ||
                    lower === "cf-connecting-ip" ||
                    lower === "cf-ray" ||
                    lower === "cf-ipcountry"
                ) {
                    continue;
                }
                headers.set(key, value);
            }

            const upstream = await fetch(targetUrl.href, {
                method: request.method,
                headers,
                body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
            });

            // Clone upstream response and add CORS headers
            const responseHeaders = new Headers(upstream.headers);
            for (const [key, value] of Object.entries(corsHeaders(request))) {
                responseHeaders.set(key, value);
            }

            return new Response(upstream.body, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers: responseHeaders,
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }), {
                status: 502,
                headers: { ...corsHeaders(request), "Content-Type": "application/json" },
            });
        }
    },
};

function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "*";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
        "Access-Control-Max-Age": "86400",
    };
}
