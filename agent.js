import express from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(express.json({ limit: "50kb" }));

const SECRET = process.env.AGENT_SECRET;
if (!SECRET) throw new Error("Missing AGENT_SECRET");

const DEPLOYS_FILE = "/opt/docker-agent/deploys.json";
const STATE_DIR = "/var/lib/docker-agent";
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOCK_DIR = path.join(STATE_DIR, "locks");

fs.mkdirSync(LOCK_DIR, { recursive: true });

// ---------- auth helpers ----------
function safeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function verifyHeaders(ts, sig, bodyStr) {
  if (!ts || !sig) return false;
  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() - t) > 60_000) return false;

  const mac = crypto
    .createHmac("sha256", SECRET)
    .update(`${ts}.${bodyStr}`)
    .digest("hex");

  return safeEq(sig, mac);
}

function requireSignedJson(req, res, next) {
  const ts = req.header("x-ts") || "";
  const sig = req.header("x-sig") || "";
  const bodyStr = JSON.stringify(req.body ?? {});
  if (!verifyHeaders(ts, sig, bodyStr)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

function requireSignedGet(req, res, next) {
  const ts = req.header("x-ts") || "";
  const sig = req.header("x-sig") || "";
  const bodyStr = "{}";
  if (!verifyHeaders(ts, sig, bodyStr)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// ---------- deploy config ----------
function loadDeploys() {
  return JSON.parse(fs.readFileSync(DEPLOYS_FILE, "utf8"));
}

function getDeploys() {
  return loadDeploys();
}

function getActions() {
  const deploys = getDeploys();
  const actions = {};
  for (const [key, value] of Object.entries(deploys)) {
    actions[`deploy:${key}`] = ["bash", [value.script]];
  }
  return actions;
}

// ---------- state / locks ----------
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { deployed: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function lockPath(key) {
  return path.join(LOCK_DIR, `${key}.lock`);
}

function acquireLock(key) {
  try {
    const fd = fs.openSync(lockPath(key), "wx");
    fs.writeFileSync(fd, JSON.stringify({ startedAt: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(key) {
  try {
    fs.unlinkSync(lockPath(key));
  } catch {}
  }

function listLocks() {
  const out = {};
  for (const f of fs.readdirSync(LOCK_DIR).filter((x) => x.endsWith(".lock"))) {
    const key = f.replace(/\.lock$/, "");
    try {
      out[key] = JSON.parse(
        fs.readFileSync(path.join(LOCK_DIR, f), "utf8")
      ).startedAt ?? null;
    } catch {
      out[key] = null;
    }
  }
  return out;
}

// ---------- git helpers ----------
function getGitRev(repoDir) {
  return new Promise((resolve) => {
    if (!repoDir) return resolve(null);

    const child = spawn("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });

    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    child.on("error", () => resolve(null));
  });
}

// ---------- SSE helpers ----------
function sseInit(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------- metrics helpers ----------}

function listLocks() {
  const out = {};
  for (const f of fs.readdirSync(LOCK_DIR).filter((x) => x.endsWith(".lock"))) {
    const key = f.replace(/\.lock$/, "");
    try {
      out[key] = JSON.parse(
        fs.readFileSync(path.join(LOCK_DIR, f), "utf8")
      ).startedAt ?? null;
    } catch {
      out[key] = null;
    }
  }
  return out;
}

// ---------- git helpers ----------
function getGitRev(repoDir) {
  return new Promise((resolve) => {
    if (!repoDir) return resolve(null);

    const child = spawn("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });

    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    child.on("error", () => resolve(null));
  });
}

// ---------- SSE helpers ----------
function sseInit(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------- metrics helpers ----------
let lastCpu = null;

function readProcStat() {
  const line = fs.readFileSync("/proc/stat", "utf8").split("\n")[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
  const idleAll = idle + iowait;
  const nonIdle = user + nice + system + irq + softirq + steal;
  const total = idleAll + nonIdle;
  return { idleAll, total };
}

function cpuPercent() {
  const cur = readProcStat();
  if (!lastCpu) {
    lastCpu = cur;
    return 0;
  }
  const totald = cur.total - lastCpu.total;
  const idled = cur.idleAll - lastCpu.idleAll;
  lastCpu = cur;
  if (totald <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idled / totald) * 100));
}

function memStats() {
  const info = fs.readFileSync("/proc/meminfo", "utf8");
  const get = (k) => {
    const m = info.match(new RegExp(`^${k}:\\s+(\\d+)\\s+kB`, "m"));
    return m ? Number(m[1]) * 1024 : 0;
  };
  const total = get("MemTotal");
  const available = get("MemAvailable");
  const used = Math.max(0, total - available);
  return {
    total,
    used,
    available,
    pct: total ? (used / total) * 100 : 0,
  };
}

// ---------- docker helpers ----------
function parseDockerPsLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const j = JSON.parse(l);
      return {
        id: j.ID,
        name: j.Names,
        image: j.Image,
        status: j.Status,
        state: j.State,
        createdAt: j.CreatedAt,
        ports: j.Ports,
      };
    });
}

// ---------- routes ----------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/deploys", requireSignedGet, (req, res) => {
  try {
    const deploys = getDeploys();
    const result = Object.entries(deploys).map(([key, value]) => ({
      key,
      label: value.label,
      repoDir: value.repoDir,
    }));
    res.json({ ok: true, deploys: result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/status", requireSignedGet, async (req, res) => {
  try {
    const state = readState();
    const deploys = getDeploys();

    const currentRepoHead = {};
    for (const [key, value] of Object.entries(deploys)) {
      currentRepoHead[key] = await getGitRev(value.repoDir);
    }

    res.json({
      ok: true,
      running: listLocks(),
      deployed: state.deployed || {},
      currentRepoHead,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/metrics", requireSignedGet, (req, res) => {
  try {
    const cpu = cpuPercent();
    const mem = memStats();

    res.json({
      ok: true,
      ts: Date.now(),
      cpu: { pct: cpu, load1: os.loadavg()[0] },
      mem: { pct: mem.pct, used: mem.used, total: mem.total },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/containers", requireSignedGet, (req, res) => {
  const child = spawn("docker", ["ps", "-a", "--format", "{{json .}}"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";

  child.stdout.on("data", (d) => {
    out += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    err += d.toString("utf8");
  });

  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        error: "docker_ps_failed",
        stderr: err,
      });
    }

    try {
      res.json({ ok: true, containers: parseDockerPsLines(out) });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: "parse_failed",
        message: e.message,
      });
    }
  });
});

app.post("/container/:id/restart", requireSignedJson, (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id || id.length > 128) {
    return res.status(400).json({ ok: false, error: "invalid_id" });
  }

  const verify = spawn("docker", ["ps", "-a", "--format", "{{.ID}} {{.Names}}"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let list = "";
  verify.stdout.on("data", (d) => {
    list += d.toString("utf8");
  });

  verify.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ ok: false, error: "docker_list_failed" });
    }

    const ok = list.split("\n").some((line) => {
      const [cid, name] = line.trim().split(/\s+/, 2);
      return cid === id || name === id;
    });

    if (!ok) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const child = spawn("docker", ["restart", id], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      err += d.toString("utf8");
    });

    child.on("close", (rc) => {
      if (rc !== 0) {
        return res.status(500).json({
          ok: false,
          error: "restart_failed",
          stderr: err,
        });
      }
      res.json({ ok: true, stdout: out.trim() });
    });
  });
});

app.post("/service/agent/restart", requireSignedJson, (req, res) => {
  try {
    const child = spawn(
      "bash",
      [
        "-lc",
        "sleep 1 && sudo systemctl restart docker-agent >/tmp/docker-agent-restart.log 2>&1 &",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );

    child.unref();

    res.json({
      ok: true,
      message: "docker-agent restart scheduled",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/logs/stream", requireSignedGet, (req, res) => {
  const id = String(req.query.container || "").trim();
  if (!id) return res.status(400).json({ error: "missing_container" });

  sseInit(res);
  sseSend(res, "start", { container: id, ts: Date.now() });

  const child = spawn("docker", ["logs", "-f", "--tail=200", id], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const keepAlive = setInterval(() => {
    sseSend(res, "ping", { t: Date.now() });
  }, 15000);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    sseSend(res, "log", { stream: "stdout", chunk });
  });

  child.stderr.on("data", (chunk) => {
    sseSend(res, "log", { stream: "stderr", chunk });
  });
  req.on("close", () => {
    clearInterval(keepAlive);
    try {
      child.kill("SIGTERM");
    } catch {}
  });

  child.on("close", (code) => {
    clearInterval(keepAlive);
    sseSend(res, "end", { code });
    res.end();
  });
});

app.get("/stream", requireSignedGet, (req, res) => {
  try {
    const action = String(req.query.action || "").trim();
    const actions = getActions();
    const entry = actions[action];

    if (!entry) {
      return res.status(400).json({ error: "unknown_action" });
    }

    const appKey = action.startsWith("deploy:") ? action.replace("deploy:", "") : null;
    if (!appKey) {
      return res.status(400).json({ error: "unknown_app" });
    }

    const deploys = getDeploys();
    const repoDir = deploys[appKey]?.repoDir || null;

    if (!acquireLock(appKey)) {
      return res.status(409).json({ error: "already_running", app: appKey });
    }

    sseInit(res);
    const startedAt = Date.now();

    sseSend(res, "start", { action, app: appKey, startedAt });
    sseSend(res, "status", {
      running: listLocks(),
      deployed: readState().deployed || {},
    });

    const keepAlive = setInterval(() => {
      sseSend(res, "ping", { t: Date.now() });
    }, 15000);

    const [cmd, args] = entry;
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      sseSend(res, "stdout", { chunk });
    });

    child.stderr.on("data", (chunk) => {
      sseSend(res, "stderr", { chunk });
    });

    const finish = async (code, signal) => {
      clearInterval(keepAlive);

      if (code === 0) {
        const rev = await getGitRev(repoDir);
        const state = readState();
        state.deployed ||= {};
        state.deployed[appKey] = {
          revision: rev || null,
          deployedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
        writeState(state);
      }

      releaseLock(appKey);
      sseSend(res, "end", { code, signal, endedAt: Date.now() });
      sseSend(res, "status", {
        running: listLocks(),
        deployed: readState().deployed || {},
      });
      res.end();
    };

    child.on("error", (err) => {
      releaseLock(appKey);
      clearInterval(keepAlive);
      sseSend(res, "error", { message: err.message });
      res.end();
    });

    child.on("close", (code, signal) => {
      finish(code, signal);
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(3005, "127.0.0.1", () => {
  console.log("Agent listening on 127.0.0.1:3005");
});
