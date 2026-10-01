const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function jwtRole(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return "";
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  try {
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return payload.role || "";
  } catch (error) {
    return "";
  }
}

function publicConfig() {
  loadEnv();
  const url = (process.env.SUPABASE_URL || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) return { configured: false };
  if (jwtRole(anonKey) === "service_role") {
    return {
      configured: false,
      error: "SUPABASE_ANON_KEY no puede ser la clave service role.",
    };
  }
  return { configured: true, url, anonKey };
}

module.exports = { root, loadEnv, jwtRole, publicConfig };
