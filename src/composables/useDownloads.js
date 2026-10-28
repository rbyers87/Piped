/**
 * Download composable with File System Access API, progress tracking, and cancel support (src/composables/useDownloads.js)
 */
export async function downloadStream(url, filename, onProgress, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress && total > 0) {
            onProgress(Math.round((loaded / total) * 100), loaded, total);
        } else if (onProgress) {
            onProgress(0, loaded, 0);
        }
    }

    const blob = new Blob(chunks);

    // Try File System Access API if available
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { success: true, method: "filesystem" };
        } catch (err) {
            if (err.name === "AbortError") {
                throw new Error("Download cancelled by user", { cause: err });
            }
            // Fall back to anchor download if user denied or error occurred
        }
    }

    // Blob fallback via anchor
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    return { success: true, method: "blob" };
}
