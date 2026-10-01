const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { root, loadEnv } = require("./env");

loadEnv();

function loadModel() {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "catalog.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/inventory-model.js"), "utf8"), context);
  return {
    catalog: context.window.CATALOG,
    model: context.window.InventoryModel,
  };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeBackup(preview) {
  const dir = path.join(root, "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `inventario-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "catalog.js",
    items: preview.items.length,
    ...preview,
  }, null, 2));
  return file;
}

async function rest(url, key, pathname, options = {}) {
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.range ? { Range: options.range } : {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = payload && payload.message ? payload.message : response.statusText;
    throw new Error(message || `Supabase respondió ${response.status}`);
  }
  return payload;
}

async function existingIds(url, key) {
  const ids = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    const rows = await rest(url, key, "objetos?select=id&order=id.asc", {
      range: `${from}-${from + size - 1}`,
    });
    const page = Array.isArray(rows) ? rows : [];
    page.forEach((row) => ids.push(row.id));
    if (page.length < size) break;
    from += size;
  }
  return new Set(ids);
}

async function insertMissing(url, key, table, rows) {
  for (let index = 0; index < rows.length; index += 50) {
    const chunk = rows.slice(index, index + 50);
    await rest(url, key, table, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: chunk,
    });
  }
}

async function main() {
  const { model, catalog } = loadModel();
  const preview = model.buildMigration(catalog, null);
  const ids = preview.items.map((item) => item.id);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length) {
    console.error(`Hay IDs repetidos en catalog.js: ${[...new Set(duplicated)].join(", ")}`);
    process.exit(1);
  }
  const backup = writeBackup(preview);
  const units = preview.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  console.log(`Copia de seguridad: ${path.relative(root, backup)}`);
  console.log(`Objetos en catalog.js: ${preview.items.length}`);
  console.log(`Unidades en catalog.js: ${units}`);
  console.log(`Ambientes: ${preview.rooms.length}`);
  console.log(`Categorías: ${preview.categories.length}`);

  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_ANON_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.");
    process.exit(1);
  }
  let host = url;
  try {
    host = new URL(url).host;
  } catch (error) {
    console.error("SUPABASE_URL no es una dirección válida.");
    process.exit(1);
  }
  console.log(`Destino: ${host}`);
  console.log(process.env.SUPABASE_SERVICE_ROLE_KEY ? "Clave: service role, solo en esta computadora." : "Clave: anon.");

  const have = await existingIds(url, key);
  const missing = preview.items.filter((item) => !have.has(item.id));
  console.log(`Objetos ya en Supabase: ${have.size}`);
  console.log(`Objetos nuevos, sin duplicar IDs: ${missing.length}`);
  if (!process.argv.includes("--apply")) {
    console.log("No se escribió nada en Supabase. Para insertar los que faltan: npm run migrate -- --apply");
    return;
  }
  if (missing.length) {
    await insertMissing(url, key, "objetos", missing.map((item) => model.toRow(item)));
  }
  const remoteRooms = new Set((await rest(url, key, "ambientes?select=slug")).map((row) => row.slug));
  const rooms = preview.rooms.filter((room) => !remoteRooms.has(room.slug));
  if (rooms.length) {
    await insertMissing(url, key, "ambientes", rooms.map((room) => ({ slug: room.slug, nombre: room.name })));
  }
  const remoteCategories = new Set((await rest(url, key, "categorias?select=nombre")).map((row) => row.nombre));
  const categories = preview.categories.filter((name) => !remoteCategories.has(name));
  if (categories.length) {
    await insertMissing(url, key, "categorias", categories.map((nombre) => ({ nombre })));
  }
  console.log(`Insertados: ${missing.length} objetos, ${rooms.length} ambientes, ${categories.length} categorías.`);
  console.log("Los registros que ya estaban no se modificaron ni se borraron.");
  console.log("Si este navegador tenía cambios solo locales, abrí Modo Anfitrión → Configuración → Subir copia de este navegador.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
