/* Reglas del inventario, sin red ni navegador.
   El precio publicado es el valor total del lote: no se multiplica por la cantidad. */
(function (root) {
  const HIDDEN_FROM_PUBLIC = new Set(["Vendido", "Retirado", "No vender"]);
  const SALE_STATUSES = ["Disponible", "Reservado", "Vendido", "Retirado", "No vender"];
  const EXTRA_ROOMS = ["Casco / Casa principal", "Comedor secundario"];

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

  function moneyOrNull(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function dateOrEmpty(value) {
    if (!value) return "";
    return String(value).slice(0, 10);
  }

  function normalizeItem(item) {
    const images = photosOf(item);
    const status = SALE_STATUSES.includes(item.status) ? item.status : item.status || "Disponible";
    const orden = Number(item.orden);
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
      price: moneyOrNull(item.price),
      status,
      published: item.published !== false,
      image: images[0] || null,
      images,
      notes: item.notes || "",
      soldPrice: moneyOrNull(item.soldPrice),
      soldAt: dateOrEmpty(item.soldAt),
      saleNotes: item.saleNotes || "",
      orden: Number.isFinite(orden) ? orden : 0,
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

  function addRoom(rooms, name, preferredSlug) {
    const clean = String(name || "").trim();
    if (!clean) return;
    const roomSlug = preferredSlug || slug(clean);
    if (rooms.some((room) => room.slug === roomSlug || room.name === clean)) return;
    rooms.push({ name: clean, slug: roomSlug });
  }

  function roomsFrom(catalog, items, storedRooms) {
    const rooms = [];
    ((catalog && catalog.rooms) || []).forEach((room) => addRoom(rooms, room.name, room.slug));
    EXTRA_ROOMS.forEach((name) => addRoom(rooms, name));
    (storedRooms || []).forEach((room) => addRoom(rooms, room.name, room.slug));
    (items || []).forEach((item) => addRoom(rooms, item.room, item.roomSlug));
    return rooms;
  }

  function hideIfNeeded(item) {
    if (HIDDEN_FROM_PUBLIC.has(item.status)) item.published = false;
    return item;
  }

  function buildMigration(catalog, browserState) {
    const source = catalog || { rooms: [], items: [] };
    const stored = browserState || {};
    const deleted = new Set(stored.deletedIds || []);
    const byId = new Map();
    (source.items || []).forEach((item, index) => {
      const normalized = hideIfNeeded(normalizeItem({ ...item, orden: index }));
      if (deleted.has(normalized.id)) {
        normalized.status = "Retirado";
        normalized.published = false;
      }
      byId.set(normalized.id, normalized);
    });
    (stored.items || []).forEach((item) => {
      const previous = byId.get(item.id);
      const normalized = hideIfNeeded(normalizeItem({
        ...item,
        orden: item.orden != null ? item.orden : previous && previous.orden,
      }));
      if (deleted.has(normalized.id)) {
        normalized.status = "Retirado";
        normalized.published = false;
      }
      if (previous && item.orden == null) normalized.orden = previous.orden;
      byId.set(normalized.id, normalized);
    });
    const items = [...byId.values()];
    return {
      items,
      rooms: roomsFrom(source, items, stored.rooms || []),
      categories: uniqueNames([...(stored.categories || []), ...items.map((entry) => entry.category)]),
      history: stored.history || [],
    };
  }

  function seed(catalog) {
    return buildMigration(catalog, null);
  }

  function sortItems(items, rooms) {
    const first = new Map();
    (items || []).forEach((item) => {
      const orden = Number(item.orden) || 0;
      if (!first.has(item.room) || orden < first.get(item.room)) first.set(item.room, orden);
    });
    const rank = new Map((rooms || []).map((room, index) => [room.name, index]));
    return [...items].sort((a, b) => {
      const aKey = first.has(a.room) ? first.get(a.room) : 100000 + (rank.get(a.room) || 0);
      const bKey = first.has(b.room) ? first.get(b.room) : 100000 + (rank.get(b.room) || 0);
      if (aKey !== bKey) return aKey - bKey;
      return (Number(a.orden) || 0) - (Number(b.orden) || 0) || String(a.id).localeCompare(String(b.id), "es");
    });
  }

  function toRow(item) {
    const normalized = normalizeItem(item);
    return {
      id: normalized.id,
      ambiente: normalized.room,
      ambiente_slug: normalized.roomSlug || slug(normalized.room),
      categoria: normalized.category,
      articulo: normalized.name,
      descripcion: normalized.description,
      cantidad: normalized.quantity,
      medidas: normalized.measures,
      detalle: normalized.condition,
      estado: normalized.status,
      precio_publicado: normalized.price,
      publicado: Boolean(normalized.published),
      foto_principal: normalized.image,
      fotos: normalized.images,
      observaciones: normalized.notes,
      precio_vendido: normalized.soldPrice,
      fecha_venta: normalized.soldAt || null,
      observaciones_venta: normalized.saleNotes,
      orden: normalized.orden,
    };
  }

  function fromRow(row) {
    let photos = row.fotos;
    if (typeof photos === "string") {
      try {
        photos = JSON.parse(photos);
      } catch (error) {
        photos = [];
      }
    }
    return normalizeItem({
      id: row.id,
      room: row.ambiente,
      roomSlug: row.ambiente_slug,
      category: row.categoria,
      name: row.articulo,
      description: row.descripcion,
      quantity: row.cantidad,
      measures: row.medidas,
      condition: row.detalle,
      price: row.precio_publicado,
      status: row.estado,
      published: row.publicado,
      image: row.foto_principal,
      images: Array.isArray(photos) ? photos : [],
      notes: row.observaciones,
      soldPrice: row.precio_vendido,
      soldAt: row.fecha_venta,
      saleNotes: row.observaciones_venta,
      orden: row.orden,
    });
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

  function metrics(items) {
    const list = items || [];
    const sum = (subset, pick) => subset.reduce((total, item) => total + pick(item), 0);
    return {
      loaded: list.length,
      units: sum(list, (item) => Number(item.quantity) || 0),
      published: list.filter((item) => item.published).length,
      available: list.filter((item) => item.status === "Disponible").length,
      reserved: list.filter((item) => item.status === "Reservado").length,
      sold: list.filter((item) => item.status === "Vendido").length,
      removed: list.filter((item) => item.status === "Retirado").length,
      notForSale: list.filter((item) => item.status === "No vender").length,
      publishedValue: sum(list.filter((item) => item.published), lotValue),
      availableValue: sum(list.filter((item) => item.status === "Disponible"), lotValue),
      reservedValue: sum(list.filter((item) => item.status === "Reservado"), lotValue),
      soldValue: sum(list.filter((item) => item.status === "Vendido"), soldValue),
    };
  }

  function summaryByName(items) {
    const groups = new Map();
    (items || []).forEach((item) => {
      const name = item.name.trim() || "Sin nombre";
      groups.set(name, (groups.get(name) || 0) + (Number(item.quantity) || 0));
    });
    return [...groups.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  function summaryByRoom(items, rooms) {
    return (rooms || []).map((room) => {
      const group = (items || []).filter((item) => item.room === room.name);
      return {
        room: room.name,
        records: group.length,
        units: group.reduce((total, item) => total + (Number(item.quantity) || 0), 0),
        available: group.filter((item) => item.status === "Disponible").length,
        sold: group.filter((item) => item.status === "Vendido").length,
        publishedValue: group.filter((item) => item.published).reduce((total, item) => total + lotValue(item), 0),
      };
    });
  }

  root.InventoryModel = {
    HIDDEN_FROM_PUBLIC,
    SALE_STATUSES,
    slug,
    normalizeItem,
    uniqueNames,
    roomsFrom,
    buildMigration,
    seed,
    sortItems,
    toRow,
    fromRow,
    isPublic,
    lotValue,
    soldValue,
    metrics,
    summaryByName,
    summaryByRoom,
  };
})(typeof window !== "undefined" ? window : globalThis);
