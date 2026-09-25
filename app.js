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

function renderStats() {
  const rooms = new Set(catalog.items.map((item) => item.room));
  const withPhoto = catalog.items.filter((item) => photosOf(item).length).length;
  const entries = [
    ["Piezas", catalog.items.length],
    ["Ambientes", rooms.size],
    ["Con foto", withPhoto],
  ];
  stats.innerHTML = entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function renderChips() {
  const options = [{ name: "Todos", slug: "todos" }, ...catalog.rooms];
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

function card(item) {
  const photos = photosOf(item);
  const count = photos.length > 1 ? `<span class="photo-count">${photos.length} fotos</span>` : "";
  const media = photos.length
    ? `<img src="${photos[0]}" alt="${escapeHtml(item.name)}" loading="lazy">${count}`
    : `<div class="placeholder">Sin foto</div>`;
  const qty = item.quantity > 1 ? `<span class="qty">× ${item.quantity}</span>` : "";
  const description = item.description ? escapeHtml(item.description) : "";
  return `
    <button class="card" type="button" data-id="${item.id}">
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
    </button>`;
}

function renderList() {
  const visible = catalog.items.filter(matches);
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
  const item = catalog.items.find((entry) => entry.id === id);
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
  const button = event.target.closest(".card");
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

renderStats();
renderChips();
renderList();
