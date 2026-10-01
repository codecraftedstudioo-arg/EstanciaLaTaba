/* Persistencia del inventario.
   Con Supabase configurado, la base central es la fuente.
   Sin configuración, el catálogo público sigue leyendo catalog.js.
   No usa localStorage como inventario. */
(function () {
  const Model = window.InventoryModel;
  if (!Model) throw new Error("Falta js/inventory-model.js");

  const BROWSER_KEY = "la-taba-anfitrion-v1";
  const HIDDEN_KEY = "la-taba-ocultos";
  const LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js";

  let memory = Model.seed(window.CATALOG);
  let client = null;
  let mode = "catalog";
  let lastError = null;
  let generation = 0;
  let readyPromise = null;
  let refreshTimer = 0;
  let subscribed = false;

  function isHostPage() {
    return typeof location !== "undefined" && /\/anfitrion(\/|$)/.test(location.pathname);
  }

  function notifyLocal() {
    window.dispatchEvent(new CustomEvent("la-taba-inventory"));
  }

  function pingTabs() {
    try {
      const channel = new BroadcastChannel("la-taba-inventory");
      channel.postMessage("changed");
      channel.close();
    } catch (error) {}
  }

  function notify() {
    notifyLocal();
    pingTabs();
  }

  function explain(error, fallback) {
    const message = (error && error.message) || "";
    if (/objetos_pkey/i.test(message)) return "Ese ID ya existe.";
    if (/duplicate key|ambientes_pkey|categorias_pkey/i.test(message)) return "Ese dato ya existe.";
    if (/objetos_cantidad_check/i.test(message)) return "La cantidad debe ser un entero mayor a cero.";
    if (/objetos_estado_check/i.test(message)) return "Ese estado no está disponible.";
    return message || fallback;
  }

  function fail(error, fallback) {
    throw new Error(explain(error, fallback));
  }

  function requireClient() {
    if (!client || mode !== "supabase") {
      throw new Error("El inventario no está conectado a Supabase. Completá SUPABASE_URL y SUPABASE_ANON_KEY para que los cambios se vean en todos los dispositivos.");
    }
  }

  function actor() {
    try {
      const session = JSON.parse(sessionStorage.getItem("la-taba-anfitrion-session") || "null");
      return session && session.user ? session.user : "";
    } catch (error) {
      return "";
    }
  }

  function readBrowserBackup() {
    try {
      const raw = localStorage.getItem(BROWSER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function hasBrowserBackup() {
    return Boolean(readBrowserBackup());
  }

  function hiddenIds() {
    const ids = new Set();
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) parsed.forEach((id) => ids.add(String(id)));
    } catch (error) {}
    const backup = readBrowserBackup();
    ((backup && backup.deletedIds) || []).forEach((id) => ids.add(String(id)));
    return ids;
  }

  function rememberHidden(id) {
    const ids = hiddenIds();
    ids.add(String(id));
    const backup = readBrowserBackup();
    const fromBackup = new Set(((backup && backup.deletedIds) || []).map(String));
    const stored = [...ids].filter((entry) => !fromBackup.has(entry));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(stored));
  }

  function overlayHidden() {
    const ids = hiddenIds();
    if (!ids.size) return;
    memory.items.forEach((item) => {
      if (!ids.has(String(item.id)) || item.status === "Vendido") return;
      item.status = "Retirado";
      item.published = false;
    });
  }

  function isShownPublic(item) {
    return Model.isPublic(item) && !hiddenIds().has(String(item.id));
  }

  async function fetchConfig() {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !body.configured || !body.url || !body.anonKey) return null;
    return { url: String(body.url), anonKey: String(body.anonKey) };
  }

  function loadLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIBRARY;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar la librería de Supabase."));
      document.head.appendChild(script);
    });
  }

  function roomsFromItems(items) {
    const rooms = [];
    items.forEach((item) => {
      if (!item.room || rooms.some((room) => room.name === item.room)) return;
      rooms.push({ name: item.room, slug: item.roomSlug || Model.slug(item.room) });
    });
    return rooms;
  }

  function remember(items, rooms, categories, history) {
    const nextRooms = rooms && rooms.length ? rooms : roomsFromItems(items);
    memory = {
      items: Model.sortItems(items, nextRooms),
      rooms: nextRooms,
      categories: Model.uniqueNames([...(categories || []), ...items.map((item) => item.category)]),
      history: history || [],
      deletedIds: [],
    };
    overlayHidden();
  }

  async function loadRemote() {
    if (isHostPage()) {
      const [objetos, ambientes, categorias, historial] = await Promise.all([
        client.from("objetos").select("*").order("orden", { ascending: true }),
        client.from("ambientes").select("*").order("nombre", { ascending: true }),
        client.from("categorias").select("*").order("nombre", { ascending: true }),
        client.from("historial").select("*").order("ocurrido", { ascending: false }).limit(200),
      ]);
      if (objetos.error) fail(objetos.error, "No se pudieron leer los objetos.");
      if (ambientes.error) fail(ambientes.error, "No se pudieron leer los ambientes.");
      if (categorias.error) fail(categorias.error, "No se pudieron leer las categorías.");
      if (historial.error) fail(historial.error, "No se pudo leer el historial.");
      const items = (objetos.data || []).map(Model.fromRow);
      const rooms = (ambientes.data || []).map((row) => ({ name: row.nombre, slug: row.slug }));
      items.forEach((item) => {
        if (item.room && !rooms.some((room) => room.name === item.room)) {
          rooms.push({ name: item.room, slug: item.roomSlug || Model.slug(item.room) });
        }
      });
      const first = new Map();
      items.forEach((item) => {
        const orden = Number(item.orden) || 0;
        if (!first.has(item.room) || orden < first.get(item.room)) first.set(item.room, orden);
      });
      rooms.sort((a, b) => {
        const aKey = first.has(a.name) ? first.get(a.name) : 100000;
        const bKey = first.has(b.name) ? first.get(b.name) : 100000;
        if (aKey !== bKey) return aKey - bKey;
        return a.name.localeCompare(b.name, "es");
      });
      const history = (historial.data || []).map((row) => ({
        id: row.id,
        at: row.ocurrido,
        itemId: row.objeto_id || "",
        itemName: row.objeto_nombre || "",
        action: row.accion,
        before: row.valor_anterior || "",
        after: row.valor_nuevo || "",
        user: row.usuario || "",
      }));
      return {
        items,
        rooms,
        categories: (categorias.data || []).map((row) => row.nombre),
        history,
      };
    }

    let response = await client.from("catalogo_publico").select("*").order("orden", { ascending: true });
    if (response.error) {
      response = await client.from("objetos").select("*").order("orden", { ascending: true });
    }
    if (response.error) fail(response.error, "No se pudo leer el catálogo.");
    const items = (response.data || []).map(Model.fromRow).filter(Model.isPublic);
    return { items, rooms: roomsFromItems(items), categories: [], history: [] };
  }

  async function refresh() {
    if (!client) return false;
    const ticket = generation;
    const next = await loadRemote();
    if (ticket !== generation) return false;
    remember(next.items, next.rooms, next.categories, next.history);
    mode = "supabase";
    lastError = null;
    return true;
  }

  function subscribe() {
    if (!client || subscribed) return;
    subscribed = true;
    client
      .channel("objetos-la-taba")
      .on("postgres_changes", { event: "*", schema: "public", table: "objetos" }, () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          refresh().then((changed) => {
            if (changed) notify();
          }).catch((error) => {
            console.error(error);
          });
        }, 250);
      })
      .subscribe();
  }

  async function boot() {
    memory = Model.seed(window.CATALOG);
    mode = "catalog";
    overlayHidden();
    try {
      const config = await fetchConfig();
      if (!config) {
        notify();
        return;
      }
      await loadLibrary();
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error("No se pudo cargar la librería de Supabase.");
      }
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const ticket = generation;
      const next = await loadRemote();
      if (ticket !== generation) return;
      remember(next.items, next.rooms, next.categories, next.history);
      mode = "supabase";
      lastError = null;
      subscribe();
      notify();
    } catch (error) {
      client = null;
      mode = "catalog";
      lastError = error;
      memory = Model.seed(window.CATALOG);
      overlayHidden();
      console.error("Supabase no está disponible. El catálogo muestra la copia incluida en el sitio.", error);
      notify();
    }
  }

  function whenReady() {
    if (!readyPromise) readyPromise = boot();
    return readyPromise;
  }

  function data() {
    return memory;
  }

  function syncRoom(item) {
    const room = memory.rooms.find((entry) => entry.slug === item.roomSlug || entry.name === item.room);
    if (room) {
      item.room = room.name;
      item.roomSlug = room.slug;
    } else if (item.room) {
      item.roomSlug = Model.slug(item.room);
    }
  }

  function nextOrden(item) {
    const siblings = memory.items.filter((entry) => entry.room === item.room && entry.id !== item.id);
    return siblings.reduce((max, entry) => Math.max(max, Number(entry.orden) || 0), 0) + 1;
  }

  function nextId() {
    const catalogItems = (window.CATALOG && window.CATALOG.items) || [];
    const numbers = [...memory.items, ...catalogItems].map((item) => Number(String(item.id).replace(/\D/g, "")) || 0);
    return `EST-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
  }

  function replaceItem(item) {
    const items = memory.items.filter((entry) => entry.id !== item.id);
    items.push(item);
    memory.items = Model.sortItems(items, memory.rooms);
    if (item.category && !memory.categories.some((name) => name.toLocaleLowerCase("es") === item.category.toLocaleLowerCase("es"))) {
      memory.categories.push(item.category);
    }
    if (item.room && !memory.rooms.some((room) => room.name === item.room)) {
      memory.rooms.push({ name: item.room, slug: item.roomSlug || Model.slug(item.room) });
    }
  }

  async function uploadDataUrl(dataUrl, itemId) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const safeId = String(itemId || "objeto").replace(/[^a-zA-Z0-9_-]/g, "") || "objeto";
    const path = `${safeId}/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.jpg`;
    const { error } = await client.storage.from("fotos").upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (error) fail(error, "No se pudo guardar la foto.");
    return client.storage.from("fotos").getPublicUrl(path).data.publicUrl;
  }

  async function storeImages(item) {
    const images = [];
    for (const src of item.images || []) {
      if (!src) continue;
      images.push(String(src).startsWith("data:") ? await uploadDataUrl(src, item.id) : src);
    }
    item.images = images;
    item.image = images[0] || null;
  }

  async function logChange(item, action, before, after) {
    const entry = {
      id: `h-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      at: new Date().toISOString(),
      itemId: item ? item.id : "",
      itemName: item ? item.name : "",
      action,
      before: before == null ? "" : String(before),
      after: after == null ? "" : String(after),
      user: actor(),
    };
    memory.history.unshift(entry);
    if (!client) return;
    const { error } = await client.from("historial").insert({
      id: entry.id,
      ocurrido: entry.at,
      objeto_id: entry.itemId,
      objeto_nombre: entry.itemName,
      accion: entry.action,
      valor_anterior: entry.before,
      valor_nuevo: entry.after,
      usuario: entry.user,
    });
    if (error) console.error(error);
  }

  async function ensureRoom(item) {
    if (!item.room) return;
    syncRoom(item);
    if (memory.rooms.some((room) => room.slug === item.roomSlug)) return;
    const room = { name: item.room, slug: item.roomSlug || Model.slug(item.room) };
    const { error } = await client.from("ambientes").insert({ slug: room.slug, nombre: room.name });
    if (error && !/duplicate key/i.test(error.message || "")) fail(error, "No se pudo guardar el ambiente.");
    memory.rooms.push(room);
  }

  async function ensureCategory(name) {
    const clean = String(name || "").trim();
    if (!clean) return;
    if (memory.categories.some((entry) => entry.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es"))) return;
    const { error } = await client.from("categorias").insert({ nombre: clean });
    if (error && !/duplicate key/i.test(error.message || "")) fail(error, "No se pudo guardar la categoría.");
    memory.categories.push(clean);
  }

  async function saveRow(row, isUpdate) {
    const query = isUpdate
      ? client.from("objetos").update(row).eq("id", row.id)
      : client.from("objetos").insert(row);
    const { data, error } = await query.select("*").single();
    if (error) fail(error, "No se pudo guardar el objeto.");
    const saved = Model.fromRow(data);
    replaceItem(saved);
    return saved;
  }

  async function createItem(input) {
    requireClient();
    generation += 1;
    const item = Model.normalizeItem({
      ...input,
      id: input.id || nextId(),
      published: Boolean(input.published),
    });
    syncRoom(item);
    if (Model.HIDDEN_FROM_PUBLIC.has(item.status)) item.published = false;
    if (item.status === "Vendido" && !item.soldAt) item.soldAt = new Date().toISOString().slice(0, 10);
    if (memory.items.some((entry) => entry.id === item.id)) throw new Error("Ese ID ya existe.");
    item.orden = nextOrden(item);
    await storeImages(item);
    await ensureRoom(item);
    await ensureCategory(item.category);
    const saved = await saveRow(Model.toRow(item), false);
    await logChange(saved, "Objeto creado", "", saved.name);
    notify();
    return saved;
  }

  async function updateItem(id, input) {
    requireClient();
    generation += 1;
    const item = memory.items.find((entry) => entry.id === id);
    if (!item) throw new Error("No se encontró el objeto.");
    const before = { ...item, images: [...item.images] };
    const next = Model.normalizeItem({ ...item, ...input, id: item.id, orden: item.orden });
    syncRoom(next);
    if (Model.HIDDEN_FROM_PUBLIC.has(next.status)) next.published = false;
    if (before.status !== "Vendido" && next.status === "Vendido" && !next.soldAt) {
      next.soldAt = new Date().toISOString().slice(0, 10);
    }
    if (before.room !== next.room) next.orden = nextOrden(next);
    await storeImages(next);
    await ensureRoom(next);
    await ensureCategory(next.category);
    const saved = await saveRow(Model.toRow(next), true);
    if (before.price !== saved.price) await logChange(saved, "Precio modificado", before.price, saved.price);
    if (before.quantity !== saved.quantity) await logChange(saved, "Cantidad modificada", before.quantity, saved.quantity);
    if (before.status !== saved.status) {
      await logChange(saved, saved.status === "Retirado" ? "Objeto retirado" : "Estado cambiado", before.status, saved.status);
    }
    if (before.published !== saved.published) {
      await logChange(saved, saved.published ? "Objeto publicado" : "Objeto retirado de la publicación", before.published, saved.published);
    }
    if (before.description !== saved.description) await logChange(saved, "Descripción modificada", before.description, saved.description);
    if (JSON.stringify(before.images) !== JSON.stringify(saved.images)) {
      await logChange(saved, "Foto modificada", "", `${saved.images.length} fotos`);
    }
    if (before.status !== "Vendido" && saved.status === "Vendido") {
      await logChange(saved, "Venta registrada", "", saved.soldPrice ?? saved.price);
    }
    notify();
    return saved;
  }

  async function retireItem(id) {
    const item = memory.items.find((entry) => entry.id === id);
    if (!item) return null;
    if (item.status === "Vendido") {
      throw new Error("Un objeto vendido no se retira. Queda en Ventas para conservar el historial.");
    }
    if (client && mode === "supabase") return updateItem(id, { status: "Retirado", published: false });
    item.status = "Retirado";
    item.published = false;
    rememberHidden(id);
    await logChange(item, "Objeto retirado", item.name, "");
    notify();
    return item;
  }

  async function duplicateItem(id) {
    const item = memory.items.find((entry) => entry.id === id);
    if (!item) throw new Error("No se encontró el objeto.");
    return createItem({
      ...item,
      id: nextId(),
      status: "Disponible",
      soldPrice: null,
      soldAt: "",
      saleNotes: "",
      published: false,
    });
  }

  async function createRoom(name) {
    requireClient();
    generation += 1;
    const clean = name.trim();
    if (!clean) throw new Error("El ambiente necesita un nombre.");
    const roomSlug = Model.slug(clean);
    if (memory.rooms.some((room) => room.slug === roomSlug)) throw new Error("Ese ambiente ya existe.");
    const { error } = await client.from("ambientes").insert({ slug: roomSlug, nombre: clean });
    if (error) fail(error, "No se pudo crear el ambiente.");
    const room = { name: clean, slug: roomSlug };
    memory.rooms.push(room);
    await logChange(null, "Ambiente creado", "", clean);
    notify();
    return room;
  }

  async function updateRoom(slugValue, name) {
    requireClient();
    generation += 1;
    const room = memory.rooms.find((entry) => entry.slug === slugValue);
    if (!room) throw new Error("No se encontró el ambiente.");
    const clean = name.trim();
    const nextSlug = Model.slug(clean);
    if (!clean) throw new Error("El ambiente necesita un nombre.");
    if (memory.rooms.some((entry) => entry.slug === nextSlug && entry !== room)) throw new Error("Ese ambiente ya existe.");
    const previous = room.name;
    const { error } = await client.from("objetos").update({ ambiente: clean, ambiente_slug: nextSlug }).eq("ambiente", previous);
    if (error) fail(error, "No se pudieron actualizar los objetos del ambiente.");
    const renamed = await client.from("ambientes").update({ nombre: clean, slug: nextSlug }).eq("slug", slugValue);
    if (renamed.error) fail(renamed.error, "No se pudo renombrar el ambiente.");
    memory.items.forEach((item) => {
      if (item.room === previous) {
        item.room = clean;
        item.roomSlug = nextSlug;
      }
    });
    room.name = clean;
    room.slug = nextSlug;
    await logChange(null, "Ambiente editado", previous, clean);
    notify();
  }

  async function deleteRoom(slugValue) {
    requireClient();
    generation += 1;
    const room = memory.rooms.find((entry) => entry.slug === slugValue);
    if (!room) return;
    if (memory.items.some((item) => item.room === room.name)) {
      throw new Error("No se puede eliminar un ambiente que todavía tiene objetos.");
    }
    const { error } = await client.from("ambientes").delete().eq("slug", slugValue);
    if (error) fail(error, "No se pudo eliminar el ambiente.");
    memory.rooms = memory.rooms.filter((entry) => entry.slug !== slugValue);
    await logChange(null, "Ambiente eliminado", room.name, "");
    notify();
  }

  async function createCategory(name) {
    requireClient();
    generation += 1;
    const clean = name.trim();
    if (!clean) throw new Error("La categoría necesita un nombre.");
    if (memory.categories.some((entry) => entry.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es"))) {
      throw new Error("Esa categoría ya existe.");
    }
    const { error } = await client.from("categorias").insert({ nombre: clean });
    if (error) fail(error, "No se pudo crear la categoría.");
    memory.categories.push(clean);
    await logChange(null, "Categoría creada", "", clean);
    notify();
  }

  async function updateCategory(previous, name) {
    requireClient();
    generation += 1;
    const clean = name.trim();
    if (!memory.categories.includes(previous)) throw new Error("No se encontró la categoría.");
    if (!clean) throw new Error("La categoría necesita un nombre.");
    if (memory.categories.some((entry) => entry !== previous && entry.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es"))) {
      throw new Error("Esa categoría ya existe.");
    }
    const { error } = await client.from("objetos").update({ categoria: clean }).eq("categoria", previous);
    if (error) fail(error, "No se pudieron actualizar los objetos de la categoría.");
    const renamed = await client.from("categorias").update({ nombre: clean }).eq("nombre", previous);
    if (renamed.error) fail(renamed.error, "No se pudo renombrar la categoría.");
    memory.categories = memory.categories.map((entry) => (entry === previous ? clean : entry));
    memory.items.forEach((item) => {
      if (item.category === previous) item.category = clean;
    });
    await logChange(null, "Categoría editada", previous, clean);
    notify();
  }

  async function deleteCategory(name) {
    requireClient();
    generation += 1;
    if (memory.items.some((item) => item.category === name)) {
      throw new Error("No se puede eliminar una categoría que todavía tiene objetos.");
    }
    const { error } = await client.from("categorias").delete().eq("nombre", name);
    if (error) fail(error, "No se pudo eliminar la categoría.");
    memory.categories = memory.categories.filter((entry) => entry !== name);
    await logChange(null, "Categoría eliminada", name, "");
    notify();
  }

  async function writeRows(items, method) {
    const rows = [];
    for (const item of items) {
      const copy = Model.normalizeItem(item);
      if (Model.HIDDEN_FROM_PUBLIC.has(copy.status)) copy.published = false;
      await storeImages(copy);
      rows.push(Model.toRow(copy));
    }
    for (let index = 0; index < rows.length; index += 50) {
      const chunk = rows.slice(index, index + 50);
      const query = method === "upsert"
        ? client.from("objetos").upsert(chunk, { onConflict: "id" })
        : client.from("objetos").insert(chunk);
      const { error } = await query;
      if (error) fail(error, "No se pudo guardar el inventario.");
    }
  }

  async function ensureRooms(rooms) {
    const { data, error } = await client.from("ambientes").select("slug");
    if (error) fail(error, "No se pudieron leer los ambientes.");
    const have = new Set((data || []).map((row) => row.slug));
    const missing = rooms.filter((room) => room.slug && !have.has(room.slug));
    if (!missing.length) return;
    const { error: insertError } = await client.from("ambientes").insert(
      missing.map((room) => ({ slug: room.slug, nombre: room.name }))
    );
    if (insertError) fail(insertError, "No se pudieron guardar los ambientes.");
  }

  async function ensureCategories(names) {
    const { data, error } = await client.from("categorias").select("nombre");
    if (error) fail(error, "No se pudieron leer las categorías.");
    const have = new Set((data || []).map((row) => row.nombre.toLocaleLowerCase("es")));
    const missing = Model.uniqueNames(names).filter((name) => !have.has(name.toLocaleLowerCase("es")));
    if (!missing.length) return;
    const { error: insertError } = await client.from("categorias").insert(missing.map((nombre) => ({ nombre })));
    if (insertError) fail(insertError, "No se pudieron guardar las categorías.");
  }

  function migrationPreview() {
    return Model.buildMigration(window.CATALOG, readBrowserBackup());
  }

  async function migrateMissing() {
    requireClient();
    generation += 1;
    const preview = migrationPreview();
    const { data, error } = await client.from("objetos").select("id");
    if (error) fail(error, "No se pudo revisar el inventario central.");
    const have = new Set((data || []).map((row) => row.id));
    const missing = preview.items.filter((item) => item.id && !have.has(item.id));
    if (missing.length) await writeRows(missing, "insert");
    await ensureRooms(preview.rooms);
    await ensureCategories(preview.categories);
    await refresh();
    notify();
    return {
      reviewed: preview.items.length,
      already: preview.items.length - missing.length,
      inserted: missing.length,
    };
  }

  async function pushBrowserCopy() {
    requireClient();
    const backup = readBrowserBackup();
    if (!backup) throw new Error("Este navegador no tiene una copia local del inventario.");
    generation += 1;
    const preview = Model.buildMigration(window.CATALOG, backup);
    await writeRows(preview.items, "upsert");
    await ensureRooms(preview.rooms);
    await ensureCategories(preview.categories);
    await refresh();
    await logChange(null, "Copia del navegador subida", "", `${preview.items.length} objetos`);
    notify();
    return { updated: preview.items.length };
  }

  function exportData() {
    return JSON.stringify(memory, null, 2);
  }

  async function importData(json) {
    requireClient();
    generation += 1;
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("El archivo no tiene un inventario válido.");
    const deleted = new Set(parsed.deletedIds || []);
    const items = parsed.items.map((item) => Model.normalizeItem(item));
    items.forEach((item) => {
      if (!deleted.has(item.id)) return;
      item.status = "Retirado";
      item.published = false;
    });
    deleted.forEach((id) => {
      if (items.some((item) => item.id === id)) return;
      const current = memory.items.find((item) => item.id === id);
      if (!current) return;
      items.push({ ...current, status: "Retirado", published: false });
    });
    await writeRows(items, "upsert");
    await ensureRooms(parsed.rooms || []);
    await ensureCategories(parsed.categories || items.map((item) => item.category));
    await refresh();
    await logChange(null, "Inventario importado", "", `${items.length} objetos`);
    notify();
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key !== HIDDEN_KEY && event.key !== BROWSER_KEY) return;
      overlayHidden();
      notifyLocal();
    });
    try {
      const channel = new BroadcastChannel("la-taba-inventory");
      channel.onmessage = () => {
        if (mode === "supabase") {
          refresh().then((changed) => {
            if (changed) notifyLocal();
          }).catch((error) => console.error(error));
          return;
        }
        overlayHidden();
        notifyLocal();
      };
    } catch (error) {}
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      if (mode === "supabase") {
        refresh().then((changed) => {
          if (changed) notifyLocal();
        }).catch((error) => console.error(error));
        return;
      }
      overlayHidden();
      notifyLocal();
    });
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || mode !== "supabase") return;
        refresh().then((changed) => {
          if (changed) notifyLocal();
        }).catch((error) => console.error(error));
      });
    }
  }

  window.InventoryStore = {
    SALE_STATUSES: Model.SALE_STATUSES,
    slug: Model.slug,
    data,
    whenReady,
    mode: () => mode,
    lastError: () => lastError,
    hasBrowserBackup,
    migrationPreview,
    migrateMissing,
    pushBrowserCopy,
    catalogSize: () => ((window.CATALOG && window.CATALOG.items) || []).length,
    publicItems: () => memory.items.filter(isShownPublic),
    publicRooms: () => {
      const visible = new Set(memory.items.filter(isShownPublic).map((item) => item.room));
      return memory.rooms.filter((room) => visible.has(room.name));
    },
    metrics: () => Model.metrics(memory.items),
    summaryByName: () => Model.summaryByName(memory.items),
    summaryByRoom: () => Model.summaryByRoom(memory.items, memory.rooms),
    catalogItems: () => memory.items.filter(isShownPublic),
    sales: () => memory.items
      .filter((item) => item.status === "Vendido")
      .map((item) => ({
        id: item.id,
        name: item.name,
        room: item.room,
        quantity: item.quantity,
        price: item.price,
        soldPrice: item.soldPrice,
        difference: item.soldPrice == null ? 0 : Number(item.soldPrice) - Model.lotValue(item),
        status: item.status,
        soldAt: item.soldAt,
        saleNotes: item.saleNotes,
      })),
    history: () => memory.history,
    createItem,
    updateItem,
    retireItem,
    deleteItem: retireItem,
    duplicateItem,
    createRoom,
    updateRoom,
    deleteRoom,
    createCategory,
    updateCategory,
    deleteCategory,
    exportData,
    importData,
    lotValue: Model.lotValue,
  };

  whenReady();
})();
