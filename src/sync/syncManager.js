/**
 * Local-First Library & GitHub Gist Sync Manager (src/sync/syncManager.js)
 * Zero-server, free sync using private GitHub Gists with Last-Write-Wins (LWW) merge logic.
 */

import { getPreferenceString, setPreference } from "@/composables/usePreferences.js";

const GIST_FILENAME = "piped-pwa-sync.json";

export function getSyncToken() {
    return getPreferenceString("gistToken", "");
}

export function getGistId() {
    return getPreferenceString("gistId", "");
}

export function setSyncConfig(token, gistId) {
    setPreference("gistToken", token);
    if (gistId) setPreference("gistId", gistId);
}

/**
 * Gather local app data for export/sync
 */
export async function collectLocalData() {
    let subscriptions;
    try {
        subscriptions = JSON.parse(localStorage.getItem("localSubscriptions")) || [];
    } catch {
        subscriptions = [];
    }

    let watchHistory = [];
    let playlists = [];

    if (window.db) {
        watchHistory = await new Promise(resolve => {
            const tx = window.db.transaction("watch_history", "readonly");
            const store = tx.objectStore("watch_history");
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        playlists = await new Promise(resolve => {
            const tx = window.db.transaction("playlists", "readonly");
            const store = tx.objectStore("playlists");
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    const preferences = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !key.startsWith("gistToken") && !key.startsWith("authToken")) {
            preferences[key] = localStorage.getItem(key);
        }
    }

    return {
        version: 1,
        updatedAt: Date.now(),
        subscriptions: {
            items: subscriptions,
            updatedAt: Number(localStorage.getItem("subscriptions_updatedAt") || Date.now()),
        },
        watchHistory: {
            items: watchHistory,
            updatedAt: Number(localStorage.getItem("watchHistory_updatedAt") || Date.now()),
        },
        playlists: {
            items: playlists,
            updatedAt: Number(localStorage.getItem("playlists_updatedAt") || Date.now()),
        },
        preferences: {
            items: preferences,
            updatedAt: Number(localStorage.getItem("preferences_updatedAt") || Date.now()),
        },
    };
}

/**
 * Import and merge data into local storage / IndexedDB
 */
export async function importData(imported) {
    if (!imported || typeof imported !== "object") throw new Error("Invalid import data");

    if (imported.subscriptions?.items) {
        localStorage.setItem("localSubscriptions", JSON.stringify(imported.subscriptions.items));
        localStorage.setItem("subscriptions_updatedAt", String(imported.subscriptions.updatedAt || Date.now()));
    }

    if (imported.preferences?.items) {
        for (const [key, val] of Object.entries(imported.preferences.items)) {
            if (val !== null && val !== undefined) {
                localStorage.setItem(key, String(val));
            }
        }
    }

    if (window.db) {
        if (Array.isArray(imported.watchHistory?.items)) {
            const tx = window.db.transaction("watch_history", "readwrite");
            const store = tx.objectStore("watch_history");
            for (const item of imported.watchHistory.items) {
                store.put(item);
            }
        }
        if (Array.isArray(imported.playlists?.items)) {
            const tx = window.db.transaction("playlists", "readwrite");
            const store = tx.objectStore("playlists");
            for (const playlist of imported.playlists.items) {
                store.put(playlist);
            }
        }
    }

    return true;
}

/**
 * Perform Last-Write-Wins (LWW) merge between local and remote dataset
 */
export async function mergeAndSave(remoteData) {
    const localData = await collectLocalData();

    // If no remote data, push local
    if (!remoteData || !remoteData.updatedAt) {
        return localData;
    }

    // Merge subscriptions (union or LWW based on timestamps)
    const localSubTime = localData.subscriptions.updatedAt || 0;
    const remoteSubTime = remoteData.subscriptions?.updatedAt || 0;
    const bestSubscriptions =
        remoteSubTime > localSubTime
            ? remoteData.subscriptions.items
            : Array.from(new Set([...localData.subscriptions.items, ...(remoteData.subscriptions?.items || [])]));

    // Merge preferences
    const localPrefTime = localData.preferences.updatedAt || 0;
    const remotePrefTime = remoteData.preferences?.updatedAt || 0;
    const bestPreferences =
        remotePrefTime > localPrefTime
            ? { ...localData.preferences.items, ...remoteData.preferences.items }
            : { ...remoteData.preferences.items, ...localData.preferences.items };

    // Merge watch history (map by videoId, LWW by watchedAt / updatedAt)
    const historyMap = new Map();
    [...(localData.watchHistory.items || []), ...(remoteData.watchHistory?.items || [])].forEach(item => {
        const existing = historyMap.get(item.videoId);
        if (!existing || (item.watchedAt || 0) > (existing.watchedAt || 0)) {
            historyMap.set(item.videoId, item);
        }
    });

    // Merge playlists (map by playlistId)
    const playlistMap = new Map();
    [...(localData.playlists.items || []), ...(remoteData.playlists?.items || [])].forEach(item => {
        const existing = playlistMap.get(item.playlistId);
        if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
            playlistMap.set(item.playlistId, item);
        }
    });

    const merged = {
        version: 1,
        updatedAt: Date.now(),
        subscriptions: { items: bestSubscriptions, updatedAt: Math.max(localSubTime, remoteSubTime) },
        watchHistory: { items: Array.from(historyMap.values()), updatedAt: Date.now() },
        playlists: { items: Array.from(playlistMap.values()), updatedAt: Date.now() },
        preferences: { items: bestPreferences, updatedAt: Math.max(localPrefTime, remotePrefTime) },
    };

    await importData(merged);
    return merged;
}

/**
 * Sync with GitHub Gist
 */
export async function syncWithGist() {
    const token = getSyncToken();
    if (!token) throw new Error("GitHub Gist personal access token not configured.");

    let gistId = getGistId();
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    };

    let remoteData = null;

    // Fetch existing Gist if ID exists
    if (gistId) {
        try {
            const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
            if (res.ok) {
                const gist = await res.json();
                if (gist.files && gist.files[GIST_FILENAME]) {
                    remoteData = JSON.parse(gist.files[GIST_FILENAME].content);
                }
            } else if (res.status === 404) {
                gistId = ""; // Reset if not found
            }
        } catch (e) {
            console.warn("Failed to fetch remote Gist, will attempt create or local push", e);
        }
    }

    // Merge local and remote
    const mergedData = await mergeAndSave(remoteData);
    const contentString = JSON.stringify(mergedData, null, 2);

    if (gistId) {
        // Update existing Gist
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({
                description: "Piped PWA Library & Settings Sync",
                files: {
                    [GIST_FILENAME]: {
                        content: contentString,
                    },
                },
            }),
        });
        if (!res.ok) throw new Error(`Failed to update Gist: ${res.status}`);
    } else {
        // Create new private Gist
        const res = await fetch("https://api.github.com/gists", {
            method: "POST",
            headers,
            body: JSON.stringify({
                description: "Piped PWA Library & Settings Sync",
                public: false,
                files: {
                    [GIST_FILENAME]: {
                        content: contentString,
                    },
                },
            }),
        });
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            if (res.status === 403) {
                throw new Error(
                    "GitHub Gist creation forbidden (403). Ensure your Personal Access Token has the 'gist' scope enabled.",
                );
            }
            throw new Error(`Failed to create Gist: ${res.status} ${errJson.message || ""}`);
        }
        const created = await res.json();
        setSyncConfig(token, created.id);
    }

    return { success: true, updatedAt: mergedData.updatedAt };
}
