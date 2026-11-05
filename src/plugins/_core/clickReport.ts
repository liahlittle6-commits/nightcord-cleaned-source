/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import Plugins from "~plugins";

interface PointerRecord {
    type: string;
    time: number;
    target: string;
    reachedBubble: boolean;
    prevented: boolean;
}

const MAX_RECORDS = 8;
const MAX_LONG_TASKS = 200;
const LONG_TASK_WINDOW_MS = 60_000;
const REPORT_KEY = "F8";
const TRACKED_EVENTS = ["pointerdown", "pointerup", "click"];

const logger = new Logger("ClickReport");
const records: PointerRecord[] = [];
const longTasks: { start: number; duration: number; }[] = [];
let lastX = 0;
let lastY = 0;
let lastMove = 0;
let longTaskObserver: PerformanceObserver | null = null;

function describe(el: Element | null) {
    if (!el) return "none";
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
}

const ago = (time: number) => time ? `${((Date.now() - time) / 1000).toFixed(1)}s ago` : "never";

function onMove(e: PointerEvent) {
    lastX = e.clientX;
    lastY = e.clientY;
    lastMove = Date.now();
}

function onCapture(e: Event) {
    records.push({ type: e.type, time: Date.now(), target: describe(e.target as Element), reachedBubble: false, prevented: false });
    if (records.length > MAX_RECORDS) records.shift();
}

function onBubble(e: Event) {
    const record = records.findLast(r => r.type === e.type);
    if (!record) return;
    record.reachedBubble = true;
    record.prevented = e.defaultPrevented;
}

function buildReport() {
    const lines = [
        `Deadcord click report ${new Date().toISOString()}`,
        `safe mode: ${!!window.DEADCORD_SAFE_MODE} | focused: ${document.hasFocus()} | visibility: ${document.visibilityState}`,
        `mouse last moved ${ago(lastMove)} at ${lastX},${lastY}`,
        "elements under mouse:"
    ];

    for (const el of document.elementsFromPoint(lastX, lastY).slice(0, 6)) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        lines.push(`  ${describe(el)} | pointer-events:${style.pointerEvents} position:${style.position} z:${style.zIndex} size:${Math.round(rect.width)}x${Math.round(rect.height)} inert:${!!el.closest("[inert]")}`);
    }

    const inert = [...document.querySelectorAll("[inert]")];
    lines.push(`inert elements: ${inert.length} ${inert.slice(0, 3).map(describe).join(", ")}`);
    lines.push(`dialogs open: ${document.querySelectorAll("[role=\"dialog\"]").length}`);
    lines.push(`body classes: ${document.body.className || "none"}`);

    lines.push("recent mouse events:");
    for (const r of records) {
        lines.push(`  ${r.type} ${ago(r.time)} on ${r.target} | reached page:${r.reachedBubble} prevented:${r.prevented}`);
    }

    const cutoff = performance.now() - LONG_TASK_WINDOW_MS;
    const recent = longTasks.filter(t => t.start >= cutoff);
    const longest = recent.reduce((max, t) => Math.max(max, t.duration), 0);
    const total = recent.reduce((sum, t) => sum + t.duration, 0);
    lines.push(`long tasks in last 60s: ${recent.length}, longest ${Math.round(longest)}ms, total ${Math.round(total)}ms`);

    const enabled = Object.keys(Plugins).filter(name => isPluginEnabled(name) && !Plugins[name].required);
    lines.push(`enabled plugins (${enabled.length}): ${enabled.join(", ")}`);

    return lines.join("\n");
}

async function onKeyDown(e: KeyboardEvent) {
    if (e.key !== REPORT_KEY) return;
    e.preventDefault();

    const report = buildReport();
    logger.info(report);
    try {
        await copyToClipboard(report);
        showToast("Click report copied, paste it into your chat with Claude", Toasts.Type.SUCCESS);
    } catch (err) {
        logger.error("Failed to copy click report", err);
        showToast("Could not copy the click report, check the console", Toasts.Type.FAILURE);
    }
}

export default definePlugin({
    name: "ClickReport",
    description: "Press F8 to copy a report of what is under your mouse, for tracking down clicks that stop working.",
    authors: [{ name: "Deadcord", id: 0n }],
    required: true,
    startAt: StartAt.Init,

    start() {
        window.addEventListener("pointermove", onMove, { capture: true, passive: true });
        for (const type of TRACKED_EVENTS) {
            window.addEventListener(type, onCapture, true);
            window.addEventListener(type, onBubble);
        }
        window.addEventListener("keydown", onKeyDown, true);

        try {
            longTaskObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
                if (longTasks.length > MAX_LONG_TASKS) longTasks.splice(0, longTasks.length - MAX_LONG_TASKS);
            });
            longTaskObserver.observe({ type: "longtask", buffered: true });
        } catch (err) {
            logger.warn("Long task tracking is not available", err);
        }
    },

    stop() {
        window.removeEventListener("pointermove", onMove, true);
        for (const type of TRACKED_EVENTS) {
            window.removeEventListener(type, onCapture, true);
            window.removeEventListener(type, onBubble);
        }
        window.removeEventListener("keydown", onKeyDown, true);
        longTaskObserver?.disconnect();
        longTaskObserver = null;
    }
});
