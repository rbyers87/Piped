import { getPreferenceBoolean, getPreferenceString, setPreference } from "./usePreferences.js";

let fallbackInstancesCache = [
    "https://pipedapi.adminforge.de",
    "https://pipedapi.privacy.com.de",
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.ducks.party",
];

async function getFallbackInstances() {
    try {
        const res = await fetch("https://corsproxy.io/?https%3A%2F%2Fpiped-instances.kavin.rocks%2F");
        if (res.ok) {
            const data = await res.json();
            const fetched = data.map(i => i.api_url).filter(Boolean);
            if (fetched.length > 0) {
                fallbackInstancesCache = Array.from(new Set([...fetched, ...fallbackInstancesCache]));
            }
        }
    } catch (e) {
        console.error("Failed to fetch public instances for fallback, using curated list", e);
    }
    return fallbackInstancesCache;
}

export async function fetchJson(url, params, options) {
    let currentUrl = url;
    if (params) {
        currentUrl = new URL(url);
        for (const pKey in params) currentUrl.searchParams.set(pKey, params[pKey]);
    }

    try {
        const response = await fetch(currentUrl, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn("API request failed for URL:", currentUrl, error);

        // Try CORS proxy fallback if direct fetch failed (e.g. CORS block from GitHub Pages)
        try {
            const urlStr = currentUrl instanceof URL ? currentUrl.href : String(currentUrl);
            if (!urlStr.includes("corsproxy.io")) {
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(urlStr)}`;
                console.log("Attempting CORS proxy fallback:", proxyUrl);
                const proxyRes = await fetch(proxyUrl, options);
                if (proxyRes.ok) {
                    return await proxyRes.json();
                }
            }
        } catch (proxyErr) {
            console.warn("CORS proxy fallback failed:", proxyErr);
        }

        const currentApi = apiUrl();
        const urlStr = currentUrl instanceof URL ? currentUrl.href : String(currentUrl);

        if (urlStr.includes(currentApi)) {
            const fallbacks = await getFallbackInstances();
            const otherFallbacks = fallbacks.filter(i => i !== currentApi);

            for (const backupUrl of otherFallbacks) {
                try {
                    console.log("Attempting fallback to instance:", backupUrl);
                    setPreference("instance", backupUrl, true);

                    let backupReqUrl = urlStr.replace(currentApi, backupUrl);
                    if (params) {
                        backupReqUrl = new URL(backupReqUrl);
                        for (const bKey in params) backupReqUrl.searchParams.set(bKey, params[bKey]);
                    }

                    const response = await fetch(backupReqUrl, options);
                    if (response.ok) {
                        window.dispatchEvent(
                            new CustomEvent("piped-instance-fallback", {
                                detail: { oldInstance: currentApi, newInstance: backupUrl },
                            }),
                        );
                        return await response.json();
                    }
                } catch (backupErr) {
                    console.warn("Fallback instance failed:", backupUrl, backupErr);
                }
            }
        }
        throw error;
    }
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
