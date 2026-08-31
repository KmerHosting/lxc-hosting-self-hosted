import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import { openDatabase } from "./db.mjs";

const dbPath = process.env.LXC_SELF_HOSTED_DB || "/var/lib/lxc-hosting-self-hosted/lxc-hosting.db";
const [command] = process.argv.slice(2);
if (command !== "reset-password") {
  console.error("Usage: lxc-hosting-reset-password [email]");
  process.exit(2);
}
const db = openDatabase(dbPath);
const rl = readline.createInterface({ input, output });
const email = (process.argv[3] || await rl.question("Account email: ")).trim().toLowerCase();
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) { console.error("No local user exists for that email."); process.exitCode = 1; }
else {
  const password = await rl.question("New password (at least 12 characters): ", { hideEchoBack: true });
  if (password.length < 12) { console.error("Password must contain at least 12 characters."); process.exitCode = 1; }
  else { db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await bcrypt.hash(password, 12), user.id); console.log("Password reset successfully."); }
}
rl.close();
