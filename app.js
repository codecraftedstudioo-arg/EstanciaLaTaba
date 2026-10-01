const catalog = window.CATALOG;
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const state = { room: "todos", query: "" };

const stats = document.querySelector("#stats");
const chips = document.querySelector("#chips");
const list = document.querySelector("#list");
const search = document.querySelector("#search");
const resultCount = document.querySelector("#result-count");
const dialog = document.querySelector("#ficha");

function formatPrice(value) {
  return value == null ? "A consultar" : money.format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function matches(item) {
  const roomOk = state.room === "todos" || item.roomSlug === state.room;
  if (!roomOk) return false;
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [item.name, item.description, item.room, item.category, item.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sourceItems() {
  return window.InventoryStore ? window.InventoryStore.publicItems() : catalog.items;
}

function sourceRooms() {
  return window.InventoryStore ? window.InventoryStore.publicRooms() : catalog.rooms;
}

function renderStats() {
  const items = sourceItems();
  const rooms = new Set(items.map((item) => item.room));
  const withPhoto = items.filter((item) => photosOf(item).length).length;
  const entries = [
    ["Piezas", items.length],
    ["Ambientes", rooms.size],
    ["Con foto", withPhoto],
  ];
  stats.innerHTML = entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function renderChips() {
  const options = [{ name: "Todos", slug: "todos" }, ...sourceRooms()];
  chips.innerHTML = options
    .map(
      (room) =>
        `<button class="chip" type="button" role="tab" data-room="${room.slug}" aria-selected="${
          room.slug === state.room
        }">${escapeHtml(room.name)}</button>`
    )
    .join("");
}

function photosOf(item) {
  if (Array.isArray(item.images) && item.images.length) return item.images;
  return item.image ? [item.image] : [];
}

function whatsappHref(name) {
  const text = [
    "Hola! Estoy interesado/a en el siguiente objeto de Estancia La Taba:",
    "",
    name,
    "",
    "Quisiera consultar si todavía está disponible.",
  ].join("\n");
  return `https://wa.me/5491167472760?text=${encodeURIComponent(text)}`;
}

function card(item) {
  const photos = photosOf(item);
  const count = photos.length > 1 ? `<span class="photo-count">${photos.length} fotos</span>` : "";
  const media = photos.length
    ? `<img src="${photos[0]}" alt="${escapeHtml(item.name)}" loading="lazy">${count}`
    : `<div class="placeholder">Sin foto</div>`;
  const qty = item.quantity > 1 ? `<span class="qty">× ${item.quantity}</span>` : "";
  const description = item.description ? escapeHtml(item.description) : "";
  return `
    <article class="card">
      <button class="card-open" type="button" data-id="${item.id}">
        <div class="media">${media}</div>
        <div class="card-body">
          <p class="card-room">${escapeHtml(item.room)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="card-desc">${description}</p>
          <div class="card-foot">
            <span class="price">${formatPrice(item.price)}</span>
            ${qty}
          </div>
        </div>
      </button>
      <a class="consult" href="${whatsappHref(item.name)}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10 10 0 0 0 4.65 1.18h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2zm5.76 13.86c-.24.68-1.4 1.3-1.94 1.38-.5.08-1.12.11-1.81-.11-.42-.14-.95-.31-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.24-.28.64-.41 1.02-.41.12 0 .23 0 .33.01.3.01.45.03.65.5.24.58.82 2 .89 2.15.07.14.12.32.02.51-.09.19-.14.31-.28.48-.14.16-.29.36-.41.48-.14.13-.28.28-.12.54.16.26.7 1.15 1.5 1.86 1.03.92 1.9 1.2 2.17 1.34.26.13.42.11.58-.07.16-.19.66-.77.84-1.03.18-.26.35-.22.58-.13.24.09 1.5.71 1.76.84.26.13.43.19.49.3.07.11.07.64-.17 1.32z"/></svg>
        Consultar
      </a>
    </article>`;
}

function renderList() {
  const visible = sourceItems().filter(matches);
  resultCount.textContent =
    visible.length === 1 ? "1 pieza" : `${visible.length} piezas`;

  if (!visible.length) {
    list.innerHTML = `<p class="empty">Ninguna pieza coincide con esa búsqueda.</p>`;
    return;
  }

  const groups = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (!last || last.room !== item.room) {
      groups.push({ room: item.room, slug: item.roomSlug, items: [item] });
    } else {
      last.items.push(item);
    }
  }

  list.innerHTML = groups
    .map(
      (group) => `
      <section class="room" id="ambiente-${group.slug}">
        <div class="room-head">
          <h2>${escapeHtml(group.room)}</h2>
          <span>${group.items.length === 1 ? "1 pieza" : `${group.items.length} piezas`}</span>
        </div>
        <div class="grid">${group.items.map(card).join("")}</div>
      </section>`
    )
    .join("");
}

function metaRow(label, value) {
  return value ? `<dt>${label}</dt><dd>${value}</dd>` : "";
}

function openFicha(id) {
  const item = sourceItems().find((entry) => entry.id === id);
  if (!item) return;
  const media = document.querySelector("#ficha-media");
  const photos = photosOf(item);
  if (!photos.length) {
    media.innerHTML = `<div class="placeholder">Sin foto</div>`;
  } else if (photos.length === 1) {
    media.innerHTML = `<img src="${photos[0]}" alt="${escapeHtml(item.name)}">`;
  } else {
    const thumbs = photos
      .map(
        (src, index) =>
          `<button class="thumb${index === 0 ? " is-active" : ""}" type="button" data-src="${src}" aria-label="Foto ${index + 1} de ${photos.length}"><img src="${src}" alt=""></button>`
      )
      .join("");
    media.innerHTML = `<img class="ficha-main" src="${photos[0]}" alt="${escapeHtml(item.name)}"><div class="thumbs">${thumbs}</div>`;
  }
  document.querySelector("#ficha-kicker").textContent = [item.room, item.category]
    .filter(Boolean)
    .join(" · ");
  dialog.dataset.id = item.id;
  document.querySelector("#ficha-title").textContent = item.name;
  document.querySelector("#ficha-price").textContent = formatPrice(item.price);
  const notes = [];
  if (item.description) {
    const text = item.description.trim();
    notes.push(/[.!?]$/.test(text) ? text : `${text}.`);
  }
  if (item.quantity > 1 && item.price != null) notes.push("Precio publicado del lote.");
  document.querySelector("#ficha-desc").textContent = notes.join(" ");
  document.querySelector("#ficha-meta").innerHTML = [
    metaRow("Cantidad", item.quantity > 1 ? String(item.quantity) : null),
    metaRow("Medidas", item.measures),
    metaRow("Estado", item.condition),
    metaRow("Venta", item.status),
    metaRow("Código", item.id),
  ].join("");
  dialog.showModal();
}

chips.addEventListener("click", (event) => {
  const button = event.target.closest(".chip");
  if (!button) return;
  state.room = button.dataset.room;
  renderChips();
  renderList();
});

search.addEventListener("input", () => {
  state.query = search.value;
  renderList();
});

list.addEventListener("click", (event) => {
  if (event.target.closest(".consult")) return;
  const button = event.target.closest(".card-open");
  if (button) openFicha(button.dataset.id);
});

document.querySelector("#ficha-media").addEventListener("click", (event) => {
  const button = event.target.closest(".thumb");
  if (!button) return;
  const main = document.querySelector(".ficha-main");
  if (main) main.src = button.dataset.src;
  document.querySelectorAll(".thumb").forEach((thumb) => {
    thumb.classList.toggle("is-active", thumb === button);
  });
});

document.querySelector("#close-ficha").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

function renderAll() {
  if (state.room !== "todos" && !sourceRooms().some((room) => room.slug === state.room)) {
    state.room = "todos";
  }
  renderStats();
  renderChips();
  renderList();
  if (dialog.open && dialog.dataset.id && !sourceItems().some((item) => item.id === dialog.dataset.id)) {
    dialog.close();
  }
}

window.addEventListener("la-taba-inventory", renderAll);

list.innerHTML = `<p class="empty">Cargando catálogo…</p>`;
window.InventoryStore.whenReady().then(renderAll).catch((error) => {
  console.error(error);
  renderAll();
});
