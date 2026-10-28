<template>
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div class="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-dark-700 dark:text-gray-100">
            <div class="mb-4 flex items-center justify-between">
                <h3 class="text-xl font-bold" v-text="$t('titles.download') || 'Download Video / Audio'" />
                <button
                    class="rounded-sm p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-dark-800"
                    @click="emit('close')"
                >
                    <i-fa6-solid-xmark />
                </button>
            </div>

            <div v-if="downloading" class="space-y-4 py-4">
                <div class="text-sm font-medium" v-text="statusMessage" />
                <div class="h-4 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-dark-800">
                    <div class="h-4 bg-red-600 transition-all duration-200" :style="{ width: progress + '%' }"></div>
                </div>
                <div class="flex justify-end">
                    <button
                        class="rounded-sm bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                        @click="cancelDownload"
                        v-text="$t('actions.cancel') || 'Cancel'"
                    />
                </div>
            </div>

            <div v-else class="max-h-[60vh] space-y-4 overflow-y-auto">
                <div class="truncate text-sm text-gray-600 dark:text-gray-300" v-text="video.title" />

                <div v-if="video.videoStreams && video.videoStreams.length > 0">
                    <h4 class="mb-2 font-semibold" v-text="'Video Streams'" />
                    <div class="space-y-2">
                        <div
                            v-for="(stream, idx) in video.videoStreams"
                            :key="idx"
                            class="flex items-center justify-between rounded-sm bg-gray-100 p-2 dark:bg-dark-800"
                        >
                            <span
                                class="text-sm font-medium"
                                v-text="
                                    `${stream.quality || 'Unknown'} — ${stream.format || 'mp4'}${stream.videoOnly ? ' (Video Only)' : ''}`
                                "
                            />
                            <button
                                class="rounded-sm bg-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-red-600 hover:text-white dark:bg-dark-800 dark:text-gray-200"
                                @click="
                                    startDownload(
                                        stream.url,
                                        `${sanitizeFilename(video.title)}_${stream.quality || 'video'}.${stream.format || 'mp4'}`,
                                    )
                                "
                                v-text="'Download'"
                            />
                        </div>
                    </div>
                </div>

                <div v-if="video.audioStreams && video.audioStreams.length > 0">
                    <h4 class="mt-4 mb-2 font-semibold" v-text="'Audio Streams'" />
                    <div class="space-y-2">
                        <div
                            v-for="(stream, idx) in video.audioStreams"
                            :key="idx"
                            class="flex items-center justify-between rounded-sm bg-gray-100 p-2 dark:bg-dark-800"
                        >
                            <span
                                class="text-sm font-medium"
                                v-text="`${stream.quality || 'Audio'} — ${stream.format || 'm4a'}`"
                            />
                            <button
                                class="rounded-sm bg-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-red-600 hover:text-white dark:bg-dark-800 dark:text-gray-200"
                                @click="
                                    startDownload(
                                        stream.url,
                                        `${sanitizeFilename(video.title)}_${stream.quality || 'audio'}.${stream.format || 'm4a'}`,
                                    )
                                "
                                v-text="'Download'"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from "vue";
import { downloadStream } from "@/composables/useDownloads.js";

defineProps({
    video: {
        type: Object,
        required: true,
    },
});

const emit = defineEmits(["close"]);

const downloading = ref(false);
const progress = ref(0);
const statusMessage = ref("");
let abortController = null;

function sanitizeFilename(name) {
    return (name || "video").replace(/[/?%*:|"<>]/g, "").trim();
}

async function startDownload(url, filename) {
    downloading.value = true;
    progress.value = 0;
    statusMessage.value = `Downloading ${filename}... (0%)`;
    abortController = new AbortController();

    try {
        await downloadStream(
            url,
            filename,
            (pct, loaded, total) => {
                progress.value = pct;
                const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
                const totalMb = total > 0 ? (total / (1024 * 1024)).toFixed(1) : "?";
                statusMessage.value = `Downloading... ${pct}% (${loadedMb}MB / ${totalMb}MB)`;
            },
            abortController.signal,
        );
        statusMessage.value = "Download completed successfully!";
        setTimeout(() => {
            downloading.value = false;
        }, 1500);
    } catch (err) {
        if (err.message.includes("cancelled")) {
            statusMessage.value = "Download cancelled.";
        } else {
            statusMessage.value = `Download failed: ${err.message}`;
        }
        setTimeout(() => {
            downloading.value = false;
        }, 2500);
    }
}

function cancelDownload() {
    if (abortController) {
        abortController.abort();
    }
}
</script>
