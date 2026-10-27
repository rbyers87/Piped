/**
 * GitHub Repository JSON Database Provider (src/sync/githubRepoDb.js)
 * Stores and commits app database (subscriptions, playlists, watch history, settings)
 * directly to a user-owned GitHub repository via GitHub REST API (Contents API).
 */

import { getPreferenceString, setPreference } from "@/composables/usePreferences.js";
import { mergeAndSave } from "./syncManager.js";

const DB_FILENAME = "piped-db.json";

export function getRepoConfig() {
    return {
        token: getPreferenceString("ghRepoToken", ""),
        owner: getPreferenceString("ghRepoOwner", ""),
        repo: getPreferenceString("ghRepoName", ""),
        branch: getPreferenceString("ghRepoBranch", "main"),
    };
}

export function setRepoConfig(token, owner, repo, branch = "main") {
    setPreference("ghRepoToken", token);
    setPreference("ghRepoOwner", owner);
    setPreference("ghRepoName", repo);
    setPreference("ghRepoBranch", branch);
}

/**
 * Fetch database JSON from GitHub repository
 */
export async function fetchDbFromRepo() {
    const { token, owner, repo, branch } = getRepoConfig();
    if (!token || !owner || !repo) {
        throw new Error("GitHub repository configuration (Token, Owner, Repo) is missing.");
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${DB_FILENAME}?ref=${branch}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
    };

    const res = await fetch(url, { headers });
    if (res.status === 404) {
        return null; // File doesn't exist yet
    }
    if (!res.ok) {
        throw new Error(`Failed to fetch database from repository: ${res.status}`);
    }

    const data = await res.json();
    const content = JSON.parse(atob(data.content));
    return { content, sha: data.sha };
}

/**
 * Commit database JSON to GitHub repository
 */
export async function saveDbToRepo(mergedData, sha = null) {
    const { token, owner, repo, branch } = getRepoConfig();
    if (!token || !owner || !repo) {
        throw new Error("GitHub repository configuration (Token, Owner, Repo) is missing.");
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${DB_FILENAME}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    };

    // If SHA is not provided, fetch latest SHA first
    if (!sha) {
        try {
            const existing = await fetchDbFromRepo();
            if (existing) {
                sha = existing.sha;
            }
        } catch {
            // Ignore if file doesn't exist yet
        }
    }

    const contentString = JSON.stringify(mergedData, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(contentString)));

    const body = {
        message: "Update Piped PWA database (piped-db.json)",
        content: base64Content,
        branch: branch,
    };
    if (sha) {
        body.sha = sha;
    }

    const res = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 404) {
            throw new Error(
                `Repository '${owner}/${repo}' not found or token lacks 'repo' permissions. Please create the repository on GitHub first.`,
            );
        }
        throw new Error(`Failed to commit database to repository: ${res.status} ${errJson.message || ""}`);
    }

    const result = await res.json();
    return { success: true, sha: result.content.sha, updatedAt: mergedData.updatedAt };
}

/**
 * Perform full sync with GitHub Repository
 */
export async function syncWithRepo() {
    let remoteData = null;
    let remoteSha = null;

    try {
        const remote = await fetchDbFromRepo();
        if (remote) {
            remoteData = remote.content;
            remoteSha = remote.sha;
        }
    } catch (e) {
        console.warn("Could not fetch remote repository database, will attempt creation/push", e);
    }

    const mergedData = await mergeAndSave(remoteData);
    const result = await saveDbToRepo(mergedData, remoteSha);
    return result;
}
