/* Capa de datos del inventario.
   Hoy persiste en este navegador. La misma API puede pasar a Supabase
   sin cambiar las pantallas. El precio publicado es el valor del lote:
   no se multiplica por la cantidad. */
(function () {
  const KEY = "la-taba-anfitrion-v1";
  const HIDDEN_FROM_PUBLIC = new Set(["Vendido", "Retirado", "No vender"]);
  const SALE_STATUSES = ["Disponible", "Reservado", "Vendido", "Retirado", "No vender"];

  function slug(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function photosOf(item) {
    if (Array.isArray(item.images) && item.images.length) return item.images.filter(Boolean);
    return item.image ? [item.image] : [];
  }

  function normalizeItem(item) {
    const images = photosOf(item);
    const status = SALE_STATUSES.includes(item.status) ? item.status : item.status || "Disponible";
    return {
      id: item.id,
      room: item.room || "",
      roomSlug: item.roomSlug || slug(item.room),
      category: item.category || "",
      name: item.name || "",
      description: item.description || "",
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
      measures: item.measures || "",
      condition: item.condition || "",
      price: item.price == null || item.price === "" ? null : Number(item.price),
      status,
      published: item.published !== false,
      image: images[0] || null,
      images,
      notes: item.notes || "",
      soldPrice: item.soldPrice == null || item.soldPrice === "" ? null : Number(item.soldPrice),
      soldAt: item.soldAt || "",
      saleNotes: item.saleNotes || "",
    };
  }

  function uniqueNames(values) {
    const seen = new Set();
    const list = [];
    values.forEach((value) => {
      const name = String(value || "").trim();
      const key = name.toLocaleLowerCase("es");
      if (!name || seen.has(key)) return;
      seen.add(key);
      list.push(name);
    });
    return list;
  }

  function seed() {
    const catalog = window.CATALOG || { rooms: [], items: [] };
    const items = (catalog.items || []).map(normalizeItem);
    const rooms = (catalog.rooms || []).map((room) => ({
      name: room.name,
      slug: room.slug || slug(room.name),
    }));
    ["Casco / Casa principal", "Comedor secundario"].forEach((name) => {
      if (!rooms.some((room) => room.slug === slug(name))) rooms.push({ name, slug: slug(name) });
    });
    return {
      items,
      rooms,
      categories: uniqueNames(items.map((item) => item.category)),
      history: [],
      deletedIds: [],
    };
  }

  function mergeWithCatalog(stored) {
    const catalog = window.CATALOG || { rooms: [], items: [] };
    const deleted = new Set(stored.deletedIds || []);
    const byId = new Map((stored.items || []).map((item) => [item.id, normalizeItem(item)]));
    (catalog.items || []).forEach((item) => {
      if (!byId.has(item.id) && !deleted.has(item.id)) byId.set(item.id, normalizeItem(item));
    });
    const order = [];
    const seen = new Set();
    (catalog.items || []).forEach((item) => {
      if (byId.has(item.id) && !seen.has(item.id)) {
        order.push(byId.get(item.id));
        seen.add(item.id);
      }
    });
    byId.forEach((item, id) => {
      if (!seen.has(id)) order.push(item);
    });
    const rooms = [...(stored.rooms || [])];
    (catalog.rooms || []).forEach((room) => {
      const roomSlug = room.slug || slug(room.name);
      if (!rooms.some((entry) => entry.slug === roomSlug)) rooms.push({ name: room.name, slug: roomSlug });
    });
    return {
      items: order,
      rooms,
      categories: uniqueNames([
        ...(stored.categories || []),
        ...order.map((item) => item.category),
      ]),
      history: stored.history || [],
      deletedIds: [...deleted],
    };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      return mergeWithCatalog(JSON.parse(raw));
    } catch (error) {
      return seed();
    }
  }

  let memory = null;

  function data() {
    if (!memory) memory = read();
    return memory;
  }

  function persist() {
    const payload = JSON.stringify(data());
    try {
      localStorage.setItem(KEY, payload);
    } catch (error) {
      throw new Error("No se pudo guardar. Las fotos ocupan demasiado espacio en este navegador.");
    }
    memory = data();
  }

  function placeWithRoom(item) {
    const items = data().items.filter((entry) => entry.id !== item.id);
    let insertAt = items.length;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].room === item.room) {
        insertAt = index + 1;
        break;
      }
    }
    items.splice(insertAt, 0, item);
    data().items = items;
  }

  function hasLocalEdits() {
    return Boolean(localStorage.getItem(KEY));
  }

  function actor() {
    try {
      const session = JSON.parse(sessionStorage.getItem("la-taba-anfitrion-session") || "null");
      return session && session.user ? session.user : "";
    } catch (error) {
      return "";
    }
  }

  function logChange(item, action, before, after) {
    data().history.unshift({
      id: `h-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      at: new Date().toISOString(),
      itemId: item ? item.id : "",
      itemName: item ? item.name : "",
      action,
      before: before == null ? "" : String(before),
      after: after == null ? "" : String(after),
      user: actor(),
    });
  }

  function syncRoom(item) {
    const room = data().rooms.find((entry) => entry.slug === item.roomSlug || entry.name === item.room);
    if (room) {
      item.room = room.name;
      item.roomSlug = room.slug;
    } else if (item.room) {
      item.roomSlug = slug(item.room);
    }
  }

  function syncImages(item) {
    item.images = (item.images || []).filter(Boolean);
    item.image = item.images[0] || null;
  }

  function nextId() {
    const numbers = data().items.map((item) => Number(String(item.id).replace(/\D/g, "")) || 0);
    const next = Math.max(0, ...numbers) + 1;
    return `EST-${String(next).padStart(3, "0")}`;
  }

  function isPublic(item) {
    return item.published !== false && !HIDDEN_FROM_PUBLIC.has(item.status);
  }

  function lotValue(item) {
    return item.price == null || Number.isNaN(Number(item.price)) ? 0 : Number(item.price);
  }

  function soldValue(item) {
    if (item.soldPrice != null && !Number.isNaN(Number(item.soldPrice))) return Number(item.soldPrice);
    return lotValue(item);
  }

  function publicItems() {
    if (!hasLocalEdits()) return (window.CATALOG && window.CATALOG.items) || [];
    return data().items.filter(isPublic);
  }

  function publicRooms() {
    if (!hasLocalEdits()) return (window.CATALOG && window.CATALOG.rooms) || [];
    const visible = new Set(publicItems().map((item) => item.room));
    return data().rooms.filter((room) => visible.has(room.name));
  }

  function metrics() {
    const items = data().items;
    const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
    return {
      loaded: items.length,
      units: sum(items, (item) => Number(item.quantity) || 0),
      published: items.filter((item) => item.published).length,
      available: items.filter((item) => item.status === "Disponible").length,
      reserved: items.filter((item) => item.status === "Reservado").length,
      sold: items.filter((item) => item.status === "Vendido").length,
      removed: items.filter((item) => item.status === "Retirado").length,
      publishedValue: sum(items.filter((item) => item.published), lotValue),
      availableValue: sum(items.filter((item) => item.status === "Disponible"), lotValue),
      reservedValue: sum(items.filter((item) => item.status === "Reservado"), lotValue),
      soldValue: sum(items.filter((item) => item.status === "Vendido"), soldValue),
    };
  }

  function summaryByName() {
    const groups = new Map();
    data().items.forEach((item) => {
      const name = item.name.trim() || "Sin nombre";
      const current = groups.get(name) || 0;
      groups.set(name, current + (Number(item.quantity) || 0));
    });
    return [...groups.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  function summaryByRoom() {
    return data().rooms.map((room) => {
      const items = data().items.filter((item) => item.room === room.name);
      return {
        room: room.name,
        records: items.length,
        units: items.reduce((total, item) => total + (Number(item.quantity) || 0), 0),
        available: items.filter((item) => item.status === "Disponible").length,
        sold: items.filter((item) => item.status === "Vendido").length,
        publishedValue: items.filter((item) => item.published).reduce((total, item) => total + lotValue(item), 0),
      };
    });
  }

  function catalogItems() {
    return data().items.filter(isPublic);
  }

  function sales() {
    return data().items
      .filter((item) => item.status === "Vendido")
      .map((item) => ({
        id: item.id,
        name: item.name,
        room: item.room,
        quantity: item.quantity,
        price: item.price,
        soldPrice: item.soldPrice,
        difference: (item.soldPrice == null ? 0 : Number(item.soldPrice) - lotValue(item)),
        status: item.status,
        soldAt: item.soldAt,
        saleNotes: item.saleNotes,
      }));
  }

  function createItem(input) {
    const item = normalizeItem({
      ...input,
      id: input.id || nextId(),
      published: Boolean(input.published),
    });
    syncRoom(item);
    syncImages(item);
    if (HIDDEN_FROM_PUBLIC.has(item.status)) item.published = false;
    if (item.status === "Vendido" && !item.soldAt) item.soldAt = new Date().toISOString().slice(0, 10);
    if (data().items.some((entry) => entry.id === item.id)) throw new Error("Ese ID ya existe.");
    placeWithRoom(item);
    if (item.category && !data().categories.some((name) => name.toLocaleLowerCase("es") === item.category.toLocaleLowerCase("es"))) {
      data().categories.push(item.category);
    }
    logChange(item, "Objeto creado", "", item.name);
    persist();
    return item;
  }

  function updateItem(id, input) {
    const item = data().items.find((entry) => entry.id === id);
    if (!item) throw new Error("No se encontró el objeto.");
    const before = { ...item, images: [...item.images] };
    const next = normalizeItem({ ...item, ...input, id: item.id });
    syncRoom(next);
    syncImages(next);
    if (HIDDEN_FROM_PUBLIC.has(next.status)) next.published = false;
    if (before.status !== "Vendido" && next.status === "Vendido" && !next.soldAt) {
      next.soldAt = new Date().toISOString().slice(0, 10);
    }
    if (before.price !== next.price) logChange(item, "Precio modificado", before.price, next.price);
    if (before.quantity !== next.quantity) logChange(item, "Cantidad modificada", before.quantity, next.quantity);
    if (before.status !== next.status) {
      logChange(item, next.status === "Retirado" ? "Objeto retirado" : "Estado cambiado", before.status, next.status);
    }
    if (before.published !== next.published) {
      logChange(item, next.published ? "Objeto publicado" : "Objeto retirado de la publicación", before.published, next.published);
    }
    if (before.description !== next.description) logChange(item, "Descripción modificada", before.description, next.description);
    if (JSON.stringify(before.images) !== JSON.stringify(next.images)) logChange(item, "Foto modificada", "", `${next.images.length} fotos`);
    if (before.status !== "Vendido" && next.status === "Vendido") logChange(item, "Venta registrada", "", next.soldPrice ?? next.price);
    Object.assign(item, next);
    if (before.room !== item.room) placeWithRoom(item);
    if (item.category && !data().categories.some((name) => name.toLocaleLowerCase("es") === item.category.toLocaleLowerCase("es"))) {
      data().categories.push(item.category);
    }
    persist();
    return item;
  }

  function deleteItem(id) {
    const item = data().items.find((entry) => entry.id === id);
    if (!item) return;
    if (item.status === "Vendido") {
      throw new Error("Un objeto vendido no se elimina. Cambiá su estado para conservar el historial.");
    }
    data().items = data().items.filter((entry) => entry.id !== id);
    data().deletedIds.push(id);
    logChange(item, "Objeto eliminado", item.name, "");
    persist();
  }

  function duplicateItem(id) {
    const item = data().items.find((entry) => entry.id === id);
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

  function createRoom(name) {
    const clean = name.trim();
    if (!clean) throw new Error("El ambiente necesita un nombre.");
    if (data().rooms.some((room) => room.slug === slug(clean))) throw new Error("Ese ambiente ya existe.");
    const room = { name: clean, slug: slug(clean) };
    data().rooms.push(room);
    logChange(null, "Ambiente creado", "", clean);
    persist();
    return room;
  }

  function updateRoom(slugValue, name) {
    const room = data().rooms.find((entry) => entry.slug === slugValue);
    if (!room) throw new Error("No se encontró el ambiente.");
    const clean = name.trim();
    const nextSlug = slug(clean);
    if (!clean) throw new Error("El ambiente necesita un nombre.");
    if (data().rooms.some((entry) => entry.slug === nextSlug && entry !== room)) throw new Error("Ese ambiente ya existe.");
    const previous = room.name;
    data().items.forEach((item) => {
      if (item.room === previous) {
        item.room = clean;
        item.roomSlug = nextSlug;
      }
    });
    room.name = clean;
    room.slug = nextSlug;
    logChange(null, "Ambiente editado", previous, clean);
    persist();
  }

  function deleteRoom(slugValue) {
    const room = data().rooms.find((entry) => entry.slug === slugValue);
    if (!room) return;
    if (data().items.some((item) => item.room === room.name)) {
      throw new Error("No se puede eliminar un ambiente que todavía tiene objetos.");
    }
    data().rooms = data().rooms.filter((entry) => entry.slug !== slugValue);
    logChange(null, "Ambiente eliminado", room.name, "");
    persist();
  }

  function createCategory(name) {
    const clean = name.trim();
    if (!clean) throw new Error("La categoría necesita un nombre.");
    if (data().categories.some((entry) => entry.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es"))) {
      throw new Error("Esa categoría ya existe.");
    }
    data().categories.push(clean);
    logChange(null, "Categoría creada", "", clean);
    persist();
  }

  function updateCategory(previous, name) {
    const clean = name.trim();
    const index = data().categories.findIndex((entry) => entry === previous);
    if (index < 0) throw new Error("No se encontró la categoría.");
    if (!clean) throw new Error("La categoría necesita un nombre.");
    if (data().categories.some((entry) => entry !== previous && entry.toLocaleLowerCase("es") === clean.toLocaleLowerCase("es"))) {
      throw new Error("Esa categoría ya existe.");
    }
    data().categories[index] = clean;
    data().items.forEach((item) => {
      if (item.category === previous) item.category = clean;
    });
    logChange(null, "Categoría editada", previous, clean);
    persist();
  }

  function deleteCategory(name) {
    if (data().items.some((item) => item.category === name)) {
      throw new Error("No se puede eliminar una categoría que todavía tiene objetos.");
    }
    data().categories = data().categories.filter((entry) => entry !== name);
    logChange(null, "Categoría eliminada", name, "");
    persist();
  }

  function exportData() {
    return JSON.stringify(data(), null, 2);
  }

  function importData(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("El archivo no tiene un inventario válido.");
    memory = mergeWithCatalog({
      items: parsed.items.map(normalizeItem),
      rooms: parsed.rooms || [],
      categories: parsed.categories || [],
      history: parsed.history || [],
      deletedIds: parsed.deletedIds || [],
    });
    logChange(null, "Inventario importado", "", `${memory.items.length} objetos`);
    persist();
  }

  window.InventoryStore = {
    SALE_STATUSES,
    slug,
    data,
    persist,
    hasLocalEdits,
    publicItems,
    publicRooms,
    metrics,
    summaryByName,
    summaryByRoom,
    catalogItems,
    sales,
    history: () => data().history,
    createItem,
    updateItem,
    deleteItem,
    duplicateItem,
    createRoom,
    updateRoom,
    deleteRoom,
    createCategory,
    updateCategory,
    deleteCategory,
    exportData,
    importData,
    lotValue,
  };
})();
