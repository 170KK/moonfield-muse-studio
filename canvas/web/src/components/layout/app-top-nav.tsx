import { Bot, Menu } from "lucide-react";
import { Button, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected) return;
        autoConnectRef.current = true;
        if (agentToken.trim()) {
            connectAgent({ silent: true });
            return;
        }
        void fetch("/local-agent-info")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.ok && data.token) {
                    if (data.url) localStorage.setItem("canvas-agent-url", data.url);
                    localStorage.setItem("canvas-agent-token", data.token);
                    setAgentState({ ...(data.url ? { url: data.url } : {}), token: data.token });
                    connectAgent({ silent: true });
                }
            })
            .catch(() => {});
    }, [agentConnected, agentEnabled, agentToken, connectAgent, setAgentState]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200/80 bg-background/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#09090b]/85">
                    <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-5">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="group flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-1.5 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:opacity-85 dark:text-stone-100">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/20">
                                    <span
                                        className="size-4 bg-current"
                                        style={{
                                            mask: "url(/logo.svg) center / contain no-repeat",
                                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                        }}
                                    />
                                </span>
                                <span className="text-[15px] font-semibold tracking-tight">{t("meta.title")}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition hover:bg-black/5 hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-4 hidden h-10 min-w-0 items-center gap-0.5 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-all",
                                                active
                                                    ? "bg-stone-900/7 font-medium text-stone-950 dark:bg-white/12 dark:text-white"
                                                    : "text-stone-500 hover:bg-stone-900/4 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/6 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-3.5" />
                                            <span className="whitespace-nowrap">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 shrink-0 items-center justify-end gap-1.5 rounded-xl border border-stone-200/80 bg-stone-100/75 px-1.5 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.04]">
                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} mouseEnterDelay={0.3}>
                                <button
                                    type="button"
                                    onClick={togglePanel}
                                    aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                                    className={cn(
                                        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors",
                                        panelOpen
                                            ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                                            : "text-stone-600 hover:bg-black/6 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
                                    )}
                                >
                                    <Bot className="size-3.5" />
                                    <span className="hidden xl:inline">Agent</span>
                                    <span
                                        className={cn(
                                            "size-1.5 rounded-full",
                                            agentConnected ? "bg-emerald-500" : "bg-stone-400/60",
                                        )}
                                    />
                                </button>
                            </Tooltip>
                            <span className="h-3.5 w-px bg-stone-300/70 dark:bg-white/12" aria-hidden="true" />
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
