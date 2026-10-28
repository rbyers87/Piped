import { getPreferenceBoolean, getPreferenceString, setPreference } from "./usePreferences.js";

// Ideally a single source of truth for this array. Make sure to keep this in sync
// with ALLOWED_HOSTS in your Cloudflare Worker (if you deploy one).
const API_INSTANCE_DEFAULTS = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.privacy.com.de",
    "https://pipedapi.ducks.party",
];

// Optional: set before building, e.g. VITE_CORS_PROXY_URL=https://yourproxy.workers.dev
const CORS_PROXY_URL = (import.meta.env.VITE_CORS_PROXY_URL || "").replace(/\/$/, "");

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(targetUrl, options = {}) {
    const { timeout, signal: userSignal, ...fetchOptions } = options;
    const timeoutSignal = AbortSignal.timeout(timeout || DEFAULT_TIMEOUT_MS);
    const signal = userSignal ? AbortSignal.any([userSignal, timeoutSignal]) : timeoutSignal;

    const response = await fetch(targetUrl, { ...fetchOptions, signal });

    if (!response.ok) {
        const text = await response.text().catch(() => "Unable to read response");
        throw new Error(`HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }

    const contentType = response.headers.get("Content-Type");
    if (contentType?.includes("application/json")) {
        return await response.json();
    }

    try {
        return await response.clone().json();
    } catch {
        throw new Error(`Unexpected Content-Type: ${contentType}`);
    }
}

export async function fetchJson(url, params, options = {}) {
    const currentUrl = new URL(typeof url === "string" ? url : url.href);
    if (params) {
        for (const pKey in params) currentUrl.searchParams.set(pKey, params[pKey]);
    }
    const urlStr = currentUrl.href;
    const instanceHost = currentUrl.hostname;

    // Only fail over to other instances for plain, unauthenticated GET requests.
    // Auth tokens belong to one instance, and POST/DELETE must not be replayed elsewhere.
    const method = (options.method || "GET").toUpperCase();
    const hasAuthHeader = !!(options.headers && (options.headers.Authorization || options.headers.authorization));
    const canFailover = method === "GET" && !hasAuthHeader;

    // Build the list of candidate URLs: the requested instance first, then the others.
    const candidates = [{ url: urlStr, host: instanceHost, isOriginal: true }];
    if (canFailover) {
        for (const backup of API_INSTANCE_DEFAULTS) {
            const backupHost = new URL(backup).hostname;
            if (backupHost === instanceHost) continue;
            const backupUrl = new URL(urlStr);
            backupUrl.hostname = backupHost;
            candidates.push({ url: backupUrl.href, host: backupHost, backup, isOriginal: false });
        }
    }

    // Strategy 1 + 2: for each instance, try a direct fetch, then your own proxy (if configured).
    for (const candidate of candidates) {
        if (!candidate.isOriginal) {
            console.log("Attempting fallback to instance:", candidate.host);
        }

        try {
            const data = await fetchWithTimeout(candidate.url, options);
            if (!candidate.isOriginal) setPreference("instance", candidate.backup, true);
            return data;
        } catch (directErr) {
            console.warn(`Direct fetch failed for ${candidate.url}:`, directErr);
        }

        if (CORS_PROXY_URL) {
            try {
                const proxied = `${CORS_PROXY_URL}/?u=${encodeURIComponent(candidate.url)}`;
                const data = await fetchWithTimeout(proxied, options);
                if (!candidate.isOriginal) setPreference("instance", candidate.backup, true);
                return data;
            } catch (proxyErr) {
                console.warn(`Custom proxy failed for ${candidate.url}:`, proxyErr);
            }
        }
    }

    // Strategy 3 (last resort): public proxy, for the originally requested URL only.
    // Note: this relays the request through a third party, so only use it for public GETs.
    if (canFailover) {
        try {
            const publicProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(urlStr)}`;
            return await fetchWithTimeout(publicProxyUrl, options);
        } catch (publicProxyErr) {
            console.warn("Public proxy (allorigins) failed:", publicProxyErr);
        }
    }

    throw new Error(`All fetch attempts failed for ${urlStr}`);
}

export function hashCode(s) {
    return s.split("").reduce(function (a, b) {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
    }, 0);
}

export function apiUrl() {
    return getPreferenceString("instance", import.meta.env.VITE_PIPED_API);
}

export function authApiUrl() {
    if (getPreferenceBoolean("authInstance", false)) {
        return getPreferenceString("auth_instance_url", apiUrl());
    } else return apiUrl();
}

export function getAuthToken() {
    return getPreferenceString("authToken" + hashCode(authApiUrl()));
}

export function isAuthenticated() {
    return getAuthToken() !== undefined;
}
