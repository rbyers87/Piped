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

    const fetchWithTimeout = async (targetUrl, signal = null) => {
        const timeoutMs = options.timeout || 8000;
        const controller = new AbortController();
        const signalWithTimeout = signal || controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(targetUrl, {
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

            try {
                const cloned = response.clone();
                return await cloned.json();
            } catch {
                throw new Error(`Unexpected Content-Type: ${contentType}`);
            }
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    };

    // Strategy 1: Direct fetch
    if (instanceHost) {
        try {
            return await fetchWithTimeout(currentUrl);
        } catch (directErr) {
            console.warn(`Direct fetch failed for ${urlStr}:`, directErr);
        }
    }

    // Strategy 2: Custom proxy if configured (VITE_CORS_PROXY_URL)
    if (CORS_PROXY_URL) {
        try {
            const proxyTarget = `${CORS_PROXY_URL}/?u=${encodeURIComponent(urlStr)}`;
            return await fetchWithTimeout(proxyTarget);
        } catch (customProxyErr) {
            console.warn("Custom CORS proxy failed:", customProxyErr);
        }
    }

    // Strategy 3: Public proxy (allorigins.win)
    try {
        const publicProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(urlStr)}`;
        return await fetchWithTimeout(publicProxyUrl);
    } catch (publicProxyErr) {
        console.warn("Public proxy (allorigins) failed:", publicProxyErr);
    }

    // Strategy 4: Instance failover to other API hosts (direct or public proxy)
    if (instanceHost) {
        const otherHosts = API_INSTANCE_DEFAULTS.filter(h => {
            const hHost = h.replace(/\/$/, "").toLowerCase();
            return hHost !== instanceHost.toLowerCase();
        });

        for (const backupUrl of otherHosts) {
            const backupHost = backupUrl.replace(/\/$/, "").toLowerCase();
            const backupUrlStr = urlStr.replace(instanceHost, backupHost);

            try {
                console.log("Attempting fallback to instance:", backupUrl.replace(/\/$/, ""));
                setPreference("instance", backupUrl, true);

                try {
                    return await fetchWithTimeout(backupUrlStr);
                } catch {
                    const backupProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(backupUrlStr)}`;
                    return await fetchWithTimeout(backupProxyUrl);
                }
            } catch (backupErr) {
                console.warn("Fallback instance failed:", backupUrl, backupErr);
            }
        }
    }

    // Final failure: all paths exhausted
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
