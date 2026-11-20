import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";

initAnalytics();

function initClientLifecycleHeartbeat() {
    if (typeof window === "undefined") return;
    let tabId = "";
    try {
        tabId = window.sessionStorage.getItem("muse_studio_tab_id") || "";
        if (!tabId) {
            tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            window.sessionStorage.setItem("muse_studio_tab_id", tabId);
        }
    } catch {
        tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const ping = () => {
        void fetch(`/client-heartbeat?id=${encodeURIComponent(tabId)}`, { method: "POST", keepalive: true }).catch(() => {});
    };
    const bye = () => {
        try {
            navigator.sendBeacon(`/client-bye?id=${encodeURIComponent(tabId)}`);
        } catch {
            // ignore
        }
    };
    ping();
    window.setInterval(ping, 5000);
    window.addEventListener("pagehide", bye);
    window.addEventListener("beforeunload", bye);
}

initClientLifecycleHeartbeat();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
