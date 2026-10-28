import { getPreferenceBoolean, getPreferenceString, setPreference } from "./usePreferences.js";

// Ideally a single source of truth for this array. Make sure to keep this in sync
// with ALLOWED_HOSTS in your Cloudflare Worker.
const API_INSTANCE_DEFAULTS = [
    "https://pipedapi.adminforge.de",
    "https://pipedapi.privacy.com.de",
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.ducks.party",
];

// Environment variable: set this before building (e.g., VITE_CORS_PROXY_URL=https://yourproxy.workers.dev)
const CORS_PROXY_URL = import.meta.env.VITE_CORS_PROXY_URL || "";

export async function fetchJson(url, params, options = {}) {
    // Helper: build absolute URL with query params, tracking the original instance host
    let instanceHost = null;
    const baseUrl = typeof url === "string" ? url : url.href;

    try {
        instanceHost = new URL(baseUrl).hostname;
    } catch {
        // If we can't parse as a URL, we can't do instance-based fallback
        instanceHost = null;
    }

    let currentUrl = baseUrl;
    if (params) {
        if (typeof currentUrl === "string") {
            currentUrl = new URL(currentUrl);
        }
        for (const pKey in params) currentUrl.searchParams.set(pKey, params[pKey]);
    }

    const urlStr = currentUrl instanceof URL ? currentUrl.href : String(currentUrl);

    // If we have a custom proxy, try it first. If not, skip proxy entirely.
    // TODO: Once your Worker is deployed, set VITE_CORS_PROXY_URL and remove this TODO.
    const proxyUrl = CORS_PROXY_URL ? `${CORS_PROXY_URL}/?u=${encodeURIComponent(urlStr)}` : null;

    const fetchWithTime = async (requestUrl, proxy, signal = null) => {
        const fullUrl = proxy
            ? `${CORS_PROXY_URL}/?u=${encodeURIComponent(requestUrl)}`
            : requestUrl;

        const signalWithTimeout = signal || new AbortController().signal;
        // Default to 8s per attempt; frontend callers can pass an options.timeout to override.
        const timeoutMs = options.timeout || 8000;
        const controller = new AbortController();

        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(fullUrl, {
                ...options,
                signal: AbortSignal.any([controller.signal, signalWithTimeout]),
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const text = await response.text().catch(() => "Unable to read response");
                throw new Error(`HTTP ${response.status}: ${text.trim() || response.statusText}`, {
                    cause: new Error(`Status ${response.status}`),
                });
            }

            const contentType = response.headers.get("Content-Type");
            if (contentType?.includes("application/json")) {
                return await response.json();
            }

            throw new Error(`Unexpected Content-Type: ${contentType}`);
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    };

    // Strategy: try direct → try proxy → try next instance (via proxy only)
    let lastError;
    const currentApi = apiUrl().replace(/\/$/, ""); // strip trailing slash

    // First attempt: direct, if we can construct a reasonable URL
    if (instanceHost) {
        try {
            console.log(`Fetching ${currentApi} directly (urlStr=${urlStr})`);
            return await fetchWithTime(currentUrl, false);
        } catch (directErr) {
            console.warn(`Direct ${currentApi} failed:`, directErr);
            lastError = directErr;
        }
    }

    // Second attempt: proxy through our Worker
    if (proxyUrl) {
        try {
            console.log("Trying proxy:", CORS_PROXY_URL);
            return await fetchWithTime(currentUrl, true);
        } catch (proxyErr) {
            console.warn("Proxy failed:", proxyErr);
            lastError = proxyErr;
        }
    }

    // Third attempt: instance failover to other API hosts via proxy
    // We only retry proxy routes if we have one. Should not hit here unless CORS_PROXY_URL is set.
    if (CORS_PROXY_URL && instanceHost) {
        const otherHosts = API_INSTANCE_DEFAULTS.filter(h => {
            const hHost = h.replace(/\/$/, "").toLowerCase();
            return hHost !== instanceHost.toLowerCase();
        });

        for (const backupUrl of otherHosts) {
            const backupHost = backupUrl.replace(/\/$/, "").toLowerCase();

            // Build replacement URL: replace instance host in the original request
            const backupUrlStr = urlStr.replace(instanceHost, backupHost);
            let backupReqUrl = backupUrlStr;
            if (params) {
                backupReqUrl = typeof backupReqUrl === "string"
                    ? new URL(backupReqUrl)
                    : backupUrlStr;
            }

            try {
                console.log("Attempting fallback to instance:", backupUrl.replace(/\/$/, ""));
                setPreference("instance", backupUrl, true);

                return await fetchWithTime(backupReqUrl, true);
            } catch (backupErr) {
                console.warn("Fallback to instance failed:", backupUrl, backupErr);
                lastError = backupErr;
            }
        }
    }

    // Final failure: all paths exhausted
    const errorMessage = `All fetch attempts failed for ${urlStr}`;
    throw new Error(errorMessage, { cause: lastError });
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
