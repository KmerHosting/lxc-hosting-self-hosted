import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { openDatabase, configured, setting, setSetting, audit } from "./db.mjs";
import { runtime, listContainers, createContainer, action, snapshot, IMAGES } from "./lxc.mjs";

const port = Number(process.env.PORT || 1974);
const host = process.env.HOST || "0.0.0.0";
const dbPath = process.env.LXC_SELF_HOSTED_DB || path.resolve("data/lxc-hosting.db");
const setupTokenFile = process.env.LXC_SELF_HOSTED_SETUP_TOKEN_FILE || path.resolve("data/setup-token");
const jwtSecretFile = process.env.LXC_SELF_HOSTED_JWT_SECRET_FILE || path.resolve("data/jwt-secret");
const db = openDatabase(dbPath);
function secret(file) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 }); return fs.readFileSync(file, "utf8").trim(); }
const setupToken = secret(setupTokenFile); const jwtSecret = secret(jwtSecretFile);
const app = express();
app.disable("x-powered-by"); app.use(express.json({ limit: "64kb" })); app.use(cookieParser());
app.use((_, res, next) => { res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); next(); });
function tokenFor(user) { return jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: "12h" }); }
function current(req) { try { return jwt.verify(req.cookies.lxc_session, jwtSecret); } catch { return null; } }
function requireUser(req, res, next) { const user = current(req); if (!user) return res.status(401).json({ error: "Sign in required." }); req.user = user; next(); }
function validEmail(email) { return /^\S+@\S+\.\S+$/.test(email); }
function safeName(name) { return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name); }
function ownContainer(req, res, next) { const item = db.prepare("SELECT * FROM containers WHERE name = ?").get(req.params.name); if (!item || (item.owner_id !== req.user.sub && req.user.role !== "admin")) return res.status(404).json({ error: "Container not found." }); req.container = item; next(); }
function fail(res, error) { res.status(400).json({ error: error instanceof Error ? error.message : "Operation failed." }); }

app.get("/api/health", async (_, res) => res.json({ ok: true, configured: configured(db), runtime: await runtime() }));
app.get("/api/auth/status", (req, res) => res.json({ configured: configured(db), user: current(req) || null, registrationOpen: setting(db, "registration_open", "true") === "true" }));
app.post("/api/auth/setup", async (req, res) => {
  if (configured(db)) return res.status(409).json({ error: "Setup is already complete." });
  const { token, email, password } = req.body || {};
  const provided = Buffer.from(String(token || "")); const expected = Buffer.from(setupToken);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return res.status(403).json({ error: "The one-time setup token is incorrect." });
  if (!validEmail(email) || String(password).length < 12) return res.status(400).json({ error: "Use a valid email and a password of at least 12 characters." });
  const id = db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?, 'admin')").run(email.trim().toLowerCase(), await bcrypt.hash(password, 12)).lastInsertRowid;
  setSetting(db, "registration_open", "true"); audit(db, id, "setup", "instance"); fs.rmSync(setupTokenFile, { force: true });
  const user = { id, email: email.trim().toLowerCase(), role: "admin" }; res.cookie("lxc_session", tokenFor(user), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 43_200_000 }); res.status(201).json({ user });
});
app.post("/api/auth/register", async (req, res) => {
  if (!configured(db)) return res.status(409).json({ error: "Finish first-run setup first." });
  if (setting(db, "registration_open", "true") !== "true") return res.status(403).json({ error: "Registration is closed by the administrator." });
  const { email, password } = req.body || {}; if (!validEmail(email) || String(password).length < 12) return res.status(400).json({ error: "Use a valid email and a password of at least 12 characters." });
  try { const id = db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?, 'member')").run(email.trim().toLowerCase(), await bcrypt.hash(password, 12)).lastInsertRowid; const user = { id, email: email.trim().toLowerCase(), role: "member" }; audit(db, id, "register", "account"); res.cookie("lxc_session", tokenFor(user), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 43_200_000 }); res.status(201).json({ user }); } catch { res.status(409).json({ error: "An account with that email already exists." }); }
});
app.post("/api/auth/login", async (req, res) => { const { email, password } = req.body || {}; const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim().toLowerCase()); if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) return res.status(401).json({ error: "Incorrect email or password." }); audit(db, user.id, "login", "account"); res.cookie("lxc_session", tokenFor(user), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 43_200_000 }); res.json({ user: { id: user.id, email: user.email, role: user.role } }); });
app.post("/api/auth/logout", (_, res) => { res.clearCookie("lxc_session"); res.status(204).end(); });
app.post("/api/auth/password", requireUser, async (req, res) => { const { currentPassword, password } = req.body || {}; const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub); if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password_hash))) return res.status(401).json({ error: "Current password is incorrect." }); if (String(password).length < 12) return res.status(400).json({ error: "New password must be at least 12 characters." }); db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await bcrypt.hash(password, 12), user.id); audit(db, user.id, "change-password", "account"); res.status(204).end(); });

app.get("/api/overview", requireUser, async (req, res) => { const command = await runtime(); const local = req.user.role === "admin" ? db.prepare("SELECT * FROM containers ORDER BY id DESC").all() : db.prepare("SELECT * FROM containers WHERE owner_id = ? ORDER BY id DESC").all(req.user.sub); const actual = await listContainers(command); const host = { hostname: os.hostname(), cpus: os.cpus().length, memoryMb: Math.floor(os.totalmem() / 1024 / 1024) }; res.json({ runtime: command, host, images: IMAGES, containers: local.map(item => ({ ...item, actual: actual.find(c => c.name === item.name) || null })), unlimited: true }); });
app.post("/api/containers", requireUser, async (req, res) => { const { name, image, cpu, memoryMb, storageGb } = req.body || {}; const values = { name: String(name || "").toLowerCase(), image, cpu: Number(cpu), memoryMb: Number(memoryMb), storageGb: Number(storageGb) }; if (!safeName(values.name)) return res.status(400).json({ error: "Use a lowercase container name: letters, numbers and hyphens." }); if (!Number.isInteger(values.cpu) || values.cpu < 1 || !Number.isInteger(values.memoryMb) || values.memoryMb < 128 || !Number.isInteger(values.storageGb) || values.storageGb < 1) return res.status(400).json({ error: "Choose valid CPU, RAM and storage values." }); const command = await runtime(); if (!command) return res.status(503).json({ error: "Neither Incus nor LXD is available on this host." }); try { await createContainer(command, values); db.prepare("INSERT INTO containers(owner_id,name,image,cpu,memory_mb,storage_gb) VALUES(?,?,?,?,?,?)").run(req.user.sub, values.name, values.image, values.cpu, values.memoryMb, values.storageGb); audit(db, req.user.sub, "create", values.name); res.status(201).json({ ok: true }); } catch (error) { fail(res, error); } });
app.post("/api/containers/:name/:command", requireUser, ownContainer, async (req, res) => { const command = req.params.command; if (!["start", "stop", "restart", "delete"].includes(command)) return res.status(404).json({ error: "Unknown action." }); const binary = await runtime(); if (!binary) return res.status(503).json({ error: "Neither Incus nor LXD is available on this host." }); try { await action(binary, req.container.name, command === "delete" ? "delete" : command); if (command === "delete") db.prepare("DELETE FROM containers WHERE id = ?").run(req.container.id); audit(db, req.user.sub, command, req.container.name); res.status(204).end(); } catch (error) { fail(res, error); } });
app.post("/api/containers/:name/snapshots", requireUser, ownContainer, async (req, res) => { const binary = await runtime(); if (!binary) return res.status(503).json({ error: "Neither Incus nor LXD is available on this host." }); const snapshotName = `snap-${Date.now()}`; try { await snapshot(binary, req.container.name, snapshotName); audit(db, req.user.sub, "snapshot", `${req.container.name}/${snapshotName}`); res.status(201).json({ name: snapshotName }); } catch (error) { fail(res, error); } });
app.use(express.static(path.resolve("public"), { index: "index.html" }));
app.get(["/setup", "/login", "/register"], (_, res) => res.sendFile(path.resolve("public/index.html")));
app.listen(port, host, () => console.log(`LXC Hosting Self-Hosted listening on ${host}:${port}`));
