import type { CSSProperties } from "react";
import { Tooltip } from "antd";
import { BookOpen, Database, Keyboard, Puzzle, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@/constant/env";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-black/6 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const locale = (i18n.resolvedLanguage as AppLocale) || "zh-CN";
    const nextLocale: AppLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {variant === "canvas" ? (
                <Tooltip title={locale === "zh-CN" ? "打开月域号池控制台" : "Open MoonField Account Pool"} mouseEnterDelay={0.3}>
                    <Link
                        to="/pool"
                        className="mr-1 inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/12 px-3 text-xs font-semibold text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-500/20 dark:text-emerald-300"
                    >
                        <Database className="size-3.5" />
                        <span>{locale === "zh-CN" ? "月域号池" : "Account Pool"}</span>
                    </Link>
                </Tooltip>
            ) : null}
            {onOpenPlugins ? (
                <Tooltip title={t("topNav.plugins")} mouseEnterDelay={0.3}>
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")}>
                        <Puzzle className="size-4" />
                    </button>
                </Tooltip>
            ) : null}
            <Tooltip title={t("topNav.docs")} mouseEnterDelay={0.3}>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.docs")}>
                    <BookOpen className="size-4" />
                </a>
            </Tooltip>
            {showConfig ? (
                <Tooltip title={t("navigation.config")} mouseEnterDelay={0.3}>
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")}>
                        <Settings2 className="size-4" />
                    </button>
                </Tooltip>
            ) : null}
            {onOpenShortcuts ? (
                <Tooltip title={t("topNav.shortcuts")} mouseEnterDelay={0.3}>
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")}>
                        <Keyboard className="size-4" />
                    </button>
                </Tooltip>
            ) : null}
            <span className="mx-0.5 h-3.5 w-px bg-stone-300/70 dark:bg-white/12" aria-hidden="true" />
            <Tooltip title={languageLabel} mouseEnterDelay={0.3}>
                <div
                    role="group"
                    aria-label={languageLabel}
                    className={cn(
                        "inline-flex h-7 items-center rounded-lg p-0.5 text-[11px] font-medium",
                        variant === "canvas"
                            ? "border border-current/15 bg-black/5 dark:bg-white/10"
                            : "border border-stone-200/80 bg-stone-200/60 dark:border-white/10 dark:bg-white/[0.06]",
                    )}
                    style={iconStyle}
                >
                    <button
                        type="button"
                        onClick={() => {
                            if (locale !== "zh-CN") void changeAppLocale("zh-CN");
                        }}
                        className={cn(
                            "cursor-pointer rounded-md px-2 py-0.5 leading-4 transition-all",
                            locale === "zh-CN"
                                ? "bg-white text-stone-950 shadow-xs dark:bg-zinc-800 dark:text-white"
                                : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200",
                        )}
                    >
                        中文
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (locale !== "en-US") void changeAppLocale("en-US");
                        }}
                        className={cn(
                            "cursor-pointer rounded-md px-2 py-0.5 leading-4 transition-all",
                            locale === "en-US"
                                ? "bg-white text-stone-950 shadow-xs dark:bg-zinc-800 dark:text-white"
                                : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200",
                        )}
                    >
                        EN
                    </button>
                </div>
            </Tooltip>
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
            />
        </div>
    );
}
