import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(process.env.MUSE_STUDIO_WEB_DIR || path.join(ROOT_DIR, "canvas", "web", "dist"));
const PORT = Number(process.env.MUSE_STUDIO_WEB_PORT || 3010);
const HOST = process.env.MUSE_STUDIO_WEB_HOST || "127.0.0.1";
const PID_FILE = path.join(ROOT_DIR, "data", "pids.json");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

const AGENT_CONFIG_PATH = path.resolve(process.env.CANVAS_AGENT_CONFIG_DIR || path.join(__dirname, "..", "data", "agent"), "canvas-agent.json");
const POOL_ENV_PATH = path.resolve(process.env.MUSE2API_HOME || path.join(__dirname, "..", "pool"), ".env");

function readPoolApiKey() {
    try {
        const raw = fs.readFileSync(POOL_ENV_PATH, "utf8");
        const match = raw.match(/^\s*MUSE2API_KEY\s*=\s*(.+?)\s*$/m);
        return match ? match[1].replace(/^['"]|['"]$/g, "") : "";
    } catch {
        return "";
    }
}

const activeClients = new Map();
let hasHadClient = false;
let shutdownTimer = null;
let isShuttingDown = false;

function killPidTree(pid) {
    if (!pid || Number.isNaN(Number(pid)) || Number(pid) === process.pid) return Promise.resolve();
    return new Promise((resolve) => {
        if (process.platform === "win32") {
            execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
        } else {
            try {
                process.kill(Number(pid), "SIGTERM");
            } catch {
                // ignore
            }
            resolve();
        }
    });
}

async function shutdownAllServices() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("All Muse Studio browser tabs closed. Shutting down background services...");
    try {
        if (fs.existsSync(PID_FILE)) {
            const pids = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
            await Promise.all([killPidTree(pids.pool), killPidTree(pids.agent)]);
            try {
                fs.unlinkSync(PID_FILE);
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}

function scheduleShutdownCheck() {
    // Only shut down when tabs explicitly fire /client-bye (pagehide/beforeunload); never expire background tabs by timer.
    if (hasHadClient && activeClients.size === 0) {
        if (!shutdownTimer) {
            shutdownTimer = setTimeout(() => {
                shutdownTimer = null;
                if (hasHadClient && activeClients.size === 0) {
                    void shutdownAllServices();
                }
            }, 10_000);
        }
    } else if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
    }
}

const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (reqUrl.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
    }
    if (reqUrl.pathname === "/client-heartbeat") {
        const clientId = (reqUrl.searchParams.get("id") || "").trim() || "default";
        hasHadClient = true;
        activeClients.set(clientId, Date.now());
        scheduleShutdownCheck();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    if (reqUrl.pathname === "/client-bye") {
        const clientId = (reqUrl.searchParams.get("id") || "").trim() || "default";
        activeClients.delete(clientId);
        scheduleShutdownCheck();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    if (reqUrl.pathname === "/local-pool-info") {
        const apiKey = readPoolApiKey();
        if (!apiKey) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, url: "http://127.0.0.1:18620/v1", apiKey }));
        return;
    }
    if (reqUrl.pathname === "/local-agent-info") {
        try {
            const cfg = JSON.parse(fs.readFileSync(AGENT_CONFIG_PATH, "utf8"));
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ ok: true, url: cfg.url || "", token: cfg.token || "" }));
        } catch {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
        }
        return;
    }
    const relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, "");
    let filePath = path.resolve(DIST_DIR, relPath || "index.html");
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
    console.log(`Muse Studio Web ready: http://${HOST}:${PORT}`);
});
