const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`FALLÓ: ${message}`);
  }
}

function load(files, sandbox) {
  const context = vm.createContext(sandbox);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  });
  return context;
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const storeSource = read("js/inventory-store.js");
assert(!storeSource.includes("localStorage.setItem(BROWSER_KEY"), "El inventario no debe reescribir la copia grande del navegador.");
assert(storeSource.includes("la-taba-ocultos"), "Un retiro sin Supabase se guarda en una lista corta de IDs.");
assert(!read("anfitrion/anfitrion.js").includes("localStorage"), "Modo Anfitrión no debe usar localStorage.");
assert(!/quantity\s*\*\s*(item\.)?price|precio_publicado\s*\*\s*cantidad/.test(read("js/inventory-model.js")), "El precio no se multiplica por la cantidad.");
["js/inventory-model.js", "js/inventory-store.js", "app.js", "anfitrion/anfitrion.js", "api/config.js", "scripts/dev-server.js", "scripts/migrate-inventory.js"].forEach((file) => {
  new vm.Script(read(file), { filename: file });
});

const base = load(["catalog.js", "js/inventory-model.js"], { window: {}, console });
const Model = base.window.InventoryModel;
const catalog = base.window.CATALOG;
assert(catalog.items.length === 132, `Se esperaban 132 objetos y hay ${catalog.items.length}.`);

const banks = catalog.items.find((item) => item.id === "EST-141");
assert(banks.quantity === 4 && banks.price === 1000000, "EST-141 conserva cantidad 4 y precio 1000000.");
const normalized = Model.normalizeItem(banks);
assert(Model.lotValue(normalized) === 1000000, "El valor del lote es 1000000, no 4000000.");
const row = Model.toRow({ ...normalized, status: "Retirado", published: false });
assert(row.estado === "Retirado" && row.publicado === false, "Retirar guarda estado Retirado y publicado false.");
assert(row.precio_publicado === 1000000 && row.cantidad === 4, "La fila retirada conserva el precio total y la cantidad.");
assert(Model.fromRow(row).id === "EST-141", "La fila vuelve al formato del catálogo.");

assert(Model.isPublic(normalized), "Un disponible publicado entra al catálogo.");
assert(!Model.isPublic({ ...normalized, status: "Retirado", published: false }), "Retirado no entra al catálogo.");
assert(!Model.isPublic({ ...normalized, status: "No vender", published: false }), "No vender no entra al catálogo.");
assert(!Model.isPublic({ ...normalized, status: "Vendido", published: false }), "Vendido no entra al catálogo.");
assert(Model.isPublic({ ...normalized, status: "Reservado", published: true }), "Reservado publicado sigue en el catálogo.");
assert(!Model.isPublic({ ...normalized, published: false }), "Un no publicado no entra al catálogo.");

const preview = Model.buildMigration(catalog, {
  items: [{ ...banks, name: "4 bancos de madera", price: 1000000, quantity: 4, status: "Disponible" }],
  deletedIds: ["EST-140"],
  rooms: [],
  categories: [],
});
const retired = preview.items.find((item) => item.id === "EST-140");
assert(retired && retired.status === "Retirado" && retired.published === false, "Un ID borrado en el navegador se migra como Retirado.");
assert(preview.items.length === 132, "La migración no duplica ni pierde objetos del catálogo.");
const mesas = Model.summaryByName(preview.items).find((entry) => entry.name === "Mesa de luz Blanca");
const mesaUnits = preview.items
  .filter((item) => item.name.trim() === "Mesa de luz Blanca")
  .reduce((total, item) => total + item.quantity, 0);
assert(mesas && mesas.quantity === mesaUnits && mesaUnits >= 2, "El resumen suma la cantidad de cada registro.");

function database() {
  const tables = { objetos: [], ambientes: [], categorias: [], historial: [] };
  function rows(name) {
    return tables[name];
  }
  function match(row, filters) {
    return filters.every(([column, value]) => row[column] === value);
  }
  function execute(name, state) {
    const source = name === "catalogo_publico"
      ? rows("objetos").filter((item) => item.publicado === true && !["Vendido", "Retirado", "No vender"].includes(item.estado))
      : rows(name);
    if (!source) return { data: null, error: { message: `No existe ${name}` } };
    if (state.op === "select") {
      let data = source.filter((row) => match(row, state.filters));
      if (state.limit != null) data = data.slice(0, state.limit);
      return { data, error: null };
    }
    if (state.op === "insert" || state.op === "upsert") {
      const incoming = Array.isArray(state.payload) ? state.payload : [state.payload];
      const saved = [];
      for (const payload of incoming) {
        const key = name === "objetos" || name === "historial" ? "id" : name === "ambientes" ? "slug" : "nombre";
        const index = source.findIndex((row) => row[key] === payload[key]);
        if (index >= 0 && state.op === "insert") {
          return { data: null, error: { message: "duplicate key value violates objetos_pkey" } };
        }
        const next = { ...payload };
        if (index >= 0) source[index] = { ...source[index], ...next };
        else source.push(next);
        saved.push(index >= 0 ? source[index] : next);
      }
      if (state.single) return { data: saved[0], error: null };
      return { data: saved, error: null };
    }
    if (state.op === "update") {
      const updated = [];
      source.forEach((row, index) => {
        if (!match(row, state.filters)) return;
        source[index] = { ...row, ...state.payload };
        updated.push(source[index]);
      });
      if (state.single) {
        if (updated.length !== 1) return { data: null, error: { message: "No se encontró el objeto." } };
        return { data: updated[0], error: null };
      }
      return { data: updated, error: null };
    }
    if (state.op === "delete") {
      for (let index = source.length - 1; index >= 0; index -= 1) {
        if (match(source[index], state.filters)) source.splice(index, 1);
      }
      return { data: null, error: null };
    }
    return { data: null, error: { message: "operación desconocida" } };
  }
  function from(name) {
    const state = { op: "select", filters: [], payload: null, single: false, limit: null };
    const api = {
      select() { return api; },
      order() { return api; },
      limit(value) { state.limit = value; return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      upsert(payload) { state.op = "upsert"; state.payload = payload; return api; },
      delete() { state.op = "delete"; return api; },
      single() { state.single = true; return api; },
      then(resolve, reject) {
        try { resolve(execute(name, state)); } catch (error) { reject(error); }
      },
    };
    return api;
  }
  const client = {
    from,
    storage: {
      from() {
        return {
          upload() { return Promise.resolve({ error: null }); },
          getPublicUrl(file) { return { data: { publicUrl: `https://cdn.example.test/fotos/${file}` } }; },
        };
      },
    },
    channel() {
      return { on() { return this; }, subscribe() { return this; } };
    },
  };
  return { tables, client };
}

async function bootStore(db, pathname, browserBackup) {
  const writes = [];
  const sandbox = {
    console,
    window: {},
    location: { pathname },
    document: {
      visibilityState: "hidden",
      addEventListener() {},
      head: {
        appendChild(script) {
          sandbox.window.supabase = { createClient: () => db.client };
          script.onload();
        },
      },
      createElement() {
        return {};
      },
    },
    localStorage: {
      getItem(key) {
        return key === "la-taba-anfitrion-v1" ? browserBackup : null;
      },
      setItem() {
        writes.push("set");
        throw new Error("no se debe escribir localStorage");
      },
    },
    sessionStorage: { getItem() { return null; } },
    fetch: async (url) => {
      if (String(url).startsWith("data:")) return { blob: async () => ({ type: "image/jpeg" }) };
      return {
        ok: true,
        json: async () => ({ configured: true, url: "https://example.supabase.co", anonKey: "anon-test" }),
      };
    },
    CustomEvent: class CustomEvent {
      constructor(type) { this.type = type; }
    },
    setTimeout,
    clearTimeout,
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.dispatchEvent = () => {};
  sandbox.window.CustomEvent = sandbox.CustomEvent;
  load(["catalog.js", "js/inventory-model.js", "js/inventory-store.js"], sandbox);
  await sandbox.window.InventoryStore.whenReady();
  return { store: sandbox.window.InventoryStore, writes };
}

async function main() {
  const db = database();
  const host = await bootStore(db, "/anfitrion/");
  assert(host.store.mode() === "supabase", "Modo Anfitrión queda conectado a Supabase.");
  assert(host.writes.length === 0, "Conectar no escribe en el navegador.");
  const created = await host.store.createItem({
    room: "Fogón",
    category: "Fogón",
    name: "Cuadro de caballo",
    description: "Prueba",
    quantity: 4,
    price: 1000000,
    status: "Disponible",
    published: true,
    images: ["data:image/jpeg;base64,AAAA"],
  });
  const maxId = Math.max(...catalog.items.map((item) => Number(String(item.id).replace(/\D/g, "")) || 0));
  const expectedId = `EST-${String(maxId + 1).padStart(3, "0")}`;
  assert(created.id === expectedId, `El alta asigna ${expectedId} y asignó ${created.id}.`);
  const stored = db.tables.objetos.find((item) => item.id === created.id);
  assert(stored && stored.precio_publicado === 1000000 && stored.cantidad === 4, "El alta guarda el precio total en Supabase.");
  assert(String(stored.foto_principal).startsWith("https://cdn.example.test/fotos/"), "La foto nueva queda en Storage, no en el navegador.");
  assert(host.store.publicItems().some((item) => item.id === created.id), "El objeto publicado entra al catálogo.");

  await host.store.updateItem(created.id, { description: "Prueba editada", price: 1000000, quantity: 4 });
  assert(db.tables.objetos.find((item) => item.id === created.id).descripcion === "Prueba editada", "La edición actualiza Supabase.");

  await host.store.updateItem(created.id, { status: "Vendido", soldPrice: 900000 });
  const sold = db.tables.objetos.find((item) => item.id === created.id);
  assert(sold.estado === "Vendido" && sold.publicado === false, "Vender deja el registro y lo saca del catálogo.");
  assert(host.store.sales().some((sale) => sale.id === created.id), "La venta sigue en el listado de ventas.");
  let blocked = false;
  try {
    await host.store.retireItem(created.id);
  } catch (error) {
    blocked = /vendido/i.test(error.message);
  }
  assert(blocked, "Un vendido no se puede retirar.");
  await host.store.updateItem(created.id, { status: "Disponible", published: true, soldPrice: null, soldAt: "" });
  assert(host.store.metrics().availableValue === 1000000, "El valor disponible es el precio del lote, no la cantidad por el precio.");

  await host.store.retireItem(created.id);
  const retired = db.tables.objetos.find((item) => item.id === created.id);
  assert(retired.estado === "Retirado" && retired.publicado === false, "Retirar no borra la fila.");
  assert(db.tables.objetos.some((item) => item.id === created.id), "El objeto sigue existiendo.");
  assert(!host.store.publicItems().some((item) => item.id === created.id), "El objeto retirado sale del catálogo.");
  await host.store.republishItem(created.id);
  const republished = db.tables.objetos.find((item) => item.id === created.id);
  assert(republished.estado === "Disponible" && republished.publicado === true, "Volver a publicar lo deja Disponible y publicado.");
  assert(host.store.publicItems().some((item) => item.id === created.id), "El objeto republicado vuelve al catálogo.");
  await host.store.retireItem(created.id);
  const stats = host.store.metrics();
  assert(stats.removed >= 1 && stats.loaded === db.tables.objetos.length, "El resumen cuenta retirados y registros.");

  const migration = await host.store.migrateMissing();
  assert(migration.inserted === 132, `La migración inserta los 132 objetos y insertó ${migration.inserted}.`);
  assert(db.tables.objetos.filter((item) => item.id === "EST-001").length === 1, "No duplica EST-001.");
  const again = await host.store.migrateMissing();
  assert(again.inserted === 0 && again.already === 132, "La segunda migración no duplica.");

  const visitor = await bootStore(db, "/");
  assert(visitor.store.mode() === "supabase", "El catálogo público consulta Supabase.");
  assert(!visitor.store.publicItems().some((item) => item.id === created.id), "Una visita nueva no muestra el objeto retirado.");
  assert(visitor.store.publicItems().some((item) => item.id === "EST-001"), "La visita sigue viendo el inventario migrado.");

  const bag = {};
  const offlineStorage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
    },
    setItem(key, value) {
      if (key !== "la-taba-ocultos") throw new Error(`no se debe escribir ${key}`);
      bag[key] = String(value);
    },
  };
  function offlineStore(pathname) {
    const sandbox = {
      console,
      window: {},
      location: { pathname },
      document: {
        visibilityState: "hidden",
        addEventListener() {},
        head: { appendChild() {} },
        createElement() { return {}; },
      },
      localStorage: offlineStorage,
      sessionStorage: { getItem() { return null; } },
      fetch: async () => ({ ok: true, json: async () => ({ configured: false }) }),
      CustomEvent: class CustomEvent {
        constructor(type) { this.type = type; }
      },
      setTimeout,
      clearTimeout,
    };
    sandbox.window.addEventListener = () => {};
    sandbox.window.dispatchEvent = () => {};
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    load(["catalog.js", "js/inventory-model.js", "js/inventory-store.js"], sandbox);
    return sandbox.window.InventoryStore;
  }
  const offlineHost = offlineStore("/anfitrion/");
  await offlineHost.whenReady();
  const hiddenTarget = offlineHost.publicItems().find((item) => item.id !== "EST-001");
  await offlineHost.retireItem(hiddenTarget.id);
  assert(offlineHost.data().items.some((item) => item.id === hiddenTarget.id && item.status === "Retirado"), "Sin Supabase, retirar conserva el registro.");
  assert(!offlineHost.publicItems().some((item) => item.id === hiddenTarget.id), "Sin Supabase, retirar lo saca del catálogo.");
  const offlineVisitor = offlineStore("/");
  await offlineVisitor.whenReady();
  assert(!offlineVisitor.publicItems().some((item) => item.id === hiddenTarget.id), "La página principal no muestra el objeto retirado.");
  assert(offlineVisitor.publicItems().some((item) => item.id === "EST-001"), "La página principal sigue mostrando el resto.");

  if (failed) {
    console.error(`${failed} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("Inventario: precio por lote, retiro lógico, migración sin duplicados y catálogo público.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
