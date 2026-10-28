/**
 * Userscript Manager (src/userscripts/userscriptManager.js)
 * Manages installing, parsing metadata, enabling/disabling, and running userscripts.
 */
import { getPreferenceJSON, setPreference } from "@/composables/usePreferences.js";

const USERSCRIPTS_KEY = "piped_installed_userscripts";

export function getInstalledScripts() {
    return getPreferenceJSON(USERSCRIPTS_KEY) || [];
}

export function saveInstalledScripts(scripts) {
    setPreference(USERSCRIPTS_KEY, scripts, true);
}

export function parseMetadata(scriptContent) {
    const metaMatch = scriptContent.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    const meta = {
        name: "Unnamed Script",
        namespace: "",
        version: "1.0",
        description: "",
        match: [],
        grant: ["none"],
    };

    if (!metaMatch) return meta;

    const lines = metaMatch[1].split("\n");
    for (const line of lines) {
        const match = line.match(/\/\/\s*@([a-z_-]+)\s+(.+)/);
        if (match) {
            const [, key, val] = match;
            const trimmedVal = val.trim();
            if (key === "match" || key === "include") {
                meta.match.push(trimmedVal);
            } else if (key === "grant") {
                if (meta.grant.includes("none")) meta.grant = [];
                meta.grant.push(trimmedVal);
            } else {
                meta[key] = trimmedVal;
            }
        }
    }

    if (meta.match.length === 0) {
        meta.match.push("*");
    }

    return meta;
}

export function installScript(code) {
    const meta = parseMetadata(code);
    const scripts = getInstalledScripts();
    const id = "script_" + Date.now();

    scripts.push({
        id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        code,
        enabled: true,
        meta,
    });

    saveInstalledScripts(scripts);
    return id;
}

export function toggleScript(id) {
    const scripts = getInstalledScripts();
    const script = scripts.find(s => s.id === id);
    if (script) {
        script.enabled = !script.enabled;
        saveInstalledScripts(scripts);
    }
}

export function deleteScript(id) {
    let scripts = getInstalledScripts();
    scripts = scripts.filter(s => s.id !== id);
    saveInstalledScripts(scripts);
}

/**
 * Run active scripts whose match pattern matches current URL
 */
export function executeActiveScripts() {
    const scripts = getInstalledScripts();
    const currentUrl = window.location.href;

    for (const script of scripts) {
        if (!script.enabled) continue;

        const matches = script.meta.match.some(pattern => {
            if (pattern === "*") return true;
            const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
            return new RegExp("^" + regexPattern + "$").test(currentUrl);
        });

        if (matches) {
            try {
                runInSandbox(script.code, script.name);
            } catch (err) {
                console.error(`Error executing userscript "${script.name}":`, err);
            }
        }
    }
}

function runInSandbox(code, scriptName) {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win.document;

    win.GM_getValue = (key, def) => {
        const val = localStorage.getItem(`gm_${scriptName}_${key}`);
        return val !== null ? JSON.parse(val) : def;
    };
    win.GM_setValue = (key, val) => {
        localStorage.setItem(`gm_${scriptName}_${key}`, JSON.stringify(val));
    };
    win.GM_xmlhttpRequest = details => {
        fetch(details.url, {
            method: details.method || "GET",
            headers: details.headers,
            body: details.data,
        })
            .then(res =>
                res.text().then(text => {
                    if (details.onload)
                        details.onload({ status: res.status, responseText: text, responseHeaders: res.headers });
                }),
            )
            .catch(err => {
                if (details.onerror) details.onerror(err);
            });
    };

    const scriptEl = doc.createElement("script");
    scriptEl.textContent = `
        try {
            (function() {
                ${code}
            }())
        } catch (e) {
            console.error("Userscript error [${scriptName}]:", e);
        }
    `;
    doc.body.appendChild(scriptEl);

    setTimeout(() => {
        try {
            document.body.removeChild(iframe);
        } catch (err) {
            console.error(err);
        }
    }, 5000);
}
