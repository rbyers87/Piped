import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import Components from "unplugin-vue-components/vite";
import IconsResolver from "unplugin-icons/resolver";
import legacy from "@vitejs/plugin-legacy";
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import eslintPlugin from "vite-plugin-eslint";

// https://vitejs.dev/config/
export default defineConfig({
    base: process.env.VITE_BASE_PATH || "/",
    plugins: [
        vue(),
        tailwindcss(),
        Icons({ compiler: "vue3", scale: 1 }),
        Components({
            resolvers: [IconsResolver()],
            dts: false,
        }),
        VueI18nPlugin({
            include: path.resolve(__dirname, "./src/locales/**"),
        }),
        legacy({
            targets: ["defaults", "not IE 11"],
        }),
        VitePWA({
            registerType: "autoUpdate",
            workbox: {
                globPatterns: [
                    "**/*.{css,html}",
                    "**/[A-Z]*.js",
                    "**/index*.js",
                    "**/shaka-player*.js",
                    "manifest.webmanifest",
                ],
                globIgnores: ["**/*-legacy-*.js"],
                runtimeCaching: [
                    {
                        // Never cache Piped API requests or our Worker proxy;
                        // these are dynamic and stale failures would persist
                        // otherwise.
                        urlPattern: /https:\/\/(pipedapi\.|corsproxy|[^/]*\.workers\.dev)/i,
                        handler: "NetworkOnly",
                    },
                    {
                        urlPattern: /https:\/\/[a-zA-Z./0-9_]*\.(?:otf|ttf)/i,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "fonts-cache",
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                ],
            },
            manifest: {
                name: "Piped PWA",
                short_name: "Piped",
                description: "Free, static, installable PWA that plays YouTube content via public Piped API instances",
                start_url: "./",
                scope: "./",
                display: "standalone",
                background_color: "#000000",
                theme_color: "#fa4b4b",
                icons: [
                    { src: "./img/icons/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
                    { src: "./img/icons/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
                    {
                        src: "./img/icons/android-chrome-maskable-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "./img/icons/android-chrome-maskable-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "maskable",
                    },
                ],
            },
        }),
        eslintPlugin(),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        sourcemap: true,
        cssMinify: "lightningcss",
    },
});
