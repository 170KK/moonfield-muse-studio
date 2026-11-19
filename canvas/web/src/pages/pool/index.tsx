import { ExternalLink } from "lucide-react";
import { Button } from "antd";

import { MUSE_POOL_API_KEY, MUSE_POOL_BASE_URL, useConfigStore } from "@/stores/use-config-store";

export default function PoolPage() {
    const poolApiKey = useConfigStore(
        (state) => state.config.channels.find((ch) => ch.id === "default")?.apiKey || state.config.apiKey || MUSE_POOL_API_KEY,
    );
    const poolBaseUrl = useConfigStore(
        (state) => state.config.channels.find((ch) => ch.id === "default")?.baseUrl || MUSE_POOL_BASE_URL,
    );
    const origin = (poolBaseUrl || MUSE_POOL_BASE_URL).replace(/\/v1\/?$/, "");
    const adminUrl = poolApiKey ? `${origin}/admin?key=${encodeURIComponent(poolApiKey)}` : `${origin}/admin`;

    return (
        <main className="flex h-full flex-col bg-background">
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-2.5 text-sm dark:border-stone-800">
                <div className="flex items-center gap-3">
                    <span className="font-medium text-stone-900 dark:text-stone-100">Muse 号池管理</span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                        {MUSE_POOL_BASE_URL}
                    </span>
                </div>
                <Button size="small" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(adminUrl, "_blank", "noopener,noreferrer")}>
                    新窗口打开
                </Button>
            </div>
            <iframe
                src={adminUrl}
                title="Muse 号池管理"
                className="h-full w-full flex-1 border-0 bg-stone-950"
            />
        </main>
    );
}
