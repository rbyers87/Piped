<template>
    <div class="flex">
        <button
            class="inline-flex items-center gap-1 rounded-sm bg-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-500 hover:text-white dark:bg-dark-400 dark:text-gray-300 dark:hover:bg-dark-300"
            @click="$router.push('/preferences')"
        >
            <i-fa6-solid-chevron-left class="shrink-0" /><span v-t="'actions.back'" />
        </button>
    </div>
    <h1 class="my-4 text-center text-2xl font-bold" v-text="'Userscript Manager'" />
    <hr class="mb-6" />

    <div class="mx-[10vw] space-y-6 max-md:mx-[2vw]">
        <!-- Install New Script Section -->
        <div class="rounded-lg bg-gray-100 p-4 shadow-sm dark:bg-dark-800">
            <h2 class="mb-2 text-lg font-semibold" v-text="'Install New Userscript'" />
            <textarea
                v-model="newScriptCode"
                rows="6"
                class="w-full rounded-sm border border-gray-300 bg-white p-2 font-mono text-sm text-gray-800 dark:border-dark-700 dark:bg-dark-900 dark:text-gray-100"
                placeholder="// ==UserScript==\n// @name         My Script\n// @match        https://*.piped.video/*\n// ==/UserScript==\n\nconsole.log('Hello from userscript');"
            ></textarea>
            <div class="mt-3 flex justify-end">
                <button
                    class="rounded-sm bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700"
                    @click="handleInstall"
                    v-text="'Install Script'"
                />
            </div>
        </div>

        <!-- Installed Scripts List -->
        <div class="rounded-lg bg-gray-100 p-4 shadow-sm dark:bg-dark-800">
            <h2 class="mb-4 text-lg font-semibold" v-text="'Installed Scripts'" />
            <div v-if="scripts.length === 0" class="text-gray-500 italic" v-text="'No userscripts installed yet.'" />
            <div v-else class="space-y-4">
                <div
                    v-for="script in scripts"
                    :key="script.id"
                    class="flex items-center justify-between rounded-sm bg-white p-4 shadow-sm dark:bg-dark-900"
                >
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="text-lg font-bold" v-text="script.name" />
                            <span
                                class="rounded-sm bg-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:bg-dark-700 dark:text-gray-300"
                                v-text="`v${script.version}`"
                            />
                        </div>
                        <p
                            class="text-sm text-gray-600 dark:text-gray-400"
                            v-text="script.description || 'No description'"
                        />
                        <div
                            class="font-mono text-xs text-gray-500"
                            v-text="`Matches: ${script.meta.match.join(', ')}`"
                        />
                    </div>
                    <div class="flex items-center gap-3">
                        <label class="relative inline-flex cursor-pointer items-center">
                            <input
                                type="checkbox"
                                :checked="script.enabled"
                                class="peer sr-only"
                                @change="handleToggle(script.id)"
                            />
                            <div
                                class="peer h-6 w-11 rounded-full bg-gray-300 peer-checked:bg-red-600 peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-gray-600 dark:bg-dark-700"
                            ></div>
                        </label>
                        <button
                            class="rounded-sm bg-red-100 px-3 py-1 text-sm text-red-600 hover:bg-red-200 dark:bg-dark-700 dark:text-red-400 dark:hover:bg-dark-700"
                            @click="handleDelete(script.id)"
                            v-text="'Delete'"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from "vue";
import { getInstalledScripts, installScript, toggleScript, deleteScript } from "@/userscripts/userscriptManager.js";

const scripts = ref(getInstalledScripts());
const newScriptCode = ref("");

function handleInstall() {
    if (!newScriptCode.value.trim()) return;
    try {
        installScript(newScriptCode.value);
        scripts.value = getInstalledScripts();
        newScriptCode.value = "";
        alert("Userscript installed successfully!");
    } catch (err) {
        alert(`Failed to install userscript: ${err.message}`);
    }
}

function handleToggle(id) {
    toggleScript(id);
    scripts.value = getInstalledScripts();
}

function handleDelete(id) {
    if (confirm("Are you sure you want to delete this userscript?")) {
        deleteScript(id);
        scripts.value = getInstalledScripts();
    }
}
</script>
