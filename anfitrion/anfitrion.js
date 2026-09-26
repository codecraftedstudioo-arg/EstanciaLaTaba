const store = window.InventoryStore;
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const NAV = [
  ["dashboard", "Dashboard"],
  ["inventario", "Inventario"],
  ["catalogo", "Catálogo"],
  ["ventas", "Ventas"],
  ["resumen", "Resumen"],
  ["ambientes", "Ambientes"],
  ["categorias", "Categorías"],
  ["historial", "Historial"],
  ["configuracion", "Configuración"],
];

const state = {
  view: "dashboard",
  query: "",
  room: "",
  category: "",
  status: "",
  published: "",
  sort: "id",
};

const view = document.querySelector("#view");
const editor = document.querySelector("#editor");

function price(value) {
  return value == null || value === "" ? "—" : money.format(Number(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showError(error) {
  window.alert(error.message || "No se pudo completar la acción.");
}

function run(action) {
  try {
    action();
    render();
  } catch (error) {
    showError(error);
  }
}

function asset(src) {
  if (!src || /^(data:|https?:|\/)/.test(src)) return src;
  return `/${src}`;
}

function photoCell(item) {
  const src = (item.images && item.images[0]) || item.image;
  return src
    ? `<img class="thumb-img" src="${asset(src)}" alt="">`
    : `<span class="thumb-img"></span>`;
}

async function optimizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No se pudo leer la foto."));
      element.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderNav() {
  document.querySelector("#nav").innerHTML = NAV.map(
    ([id, label]) =>
      `<button type="button" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${label}</button>`
  ).join("");
  document.querySelector("#view-title").textContent =
    state.view === "dashboard" ? "Modo Anfitrión" : NAV.find(([id]) => id === state.view)[1];
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function renderDashboard() {
  const stats = store.metrics();
  view.innerHTML = `
    <p class="eyebrow">Administración — Estancia La Taba</p>
    <h2 class="lede" style="font-family:var(--serif);font-size:2rem;color:var(--ink);margin:0">Modo Anfitrión</h2>
    <section class="cards">
      ${metric("Objetos cargados", stats.loaded)}
      ${metric("Unidades totales", stats.units)}
      ${metric("Objetos publicados", stats.published)}
      ${metric("Objetos disponibles", stats.available)}
      ${metric("Objetos reservados", stats.reserved)}
      ${metric("Objetos vendidos", stats.sold)}
      ${metric("Objetos retirados", stats.removed)}
      ${metric("Valor total publicado", price(stats.publishedValue))}
      ${metric("Valor disponible", price(stats.availableValue))}
      ${metric("Valor vendido", price(stats.soldValue))}
    </section>
    <p class="lede">El precio publicado es el valor del lote. No se multiplica por la cantidad.</p>`;
}

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase("es");
  let items = store.data().items.filter((item) => {
    if (state.room && item.room !== state.room) return false;
    if (state.category && item.category !== state.category) return false;
    if (state.status && item.status !== state.status) return false;
    if (state.published === "si" && !item.published) return false;
    if (state.published === "no" && item.published) return false;
    if (!query) return true;
    return [item.id, item.name, item.description, item.room, item.category]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(query);
  });
  const sorters = {
    id: (a, b) => a.id.localeCompare(b.id, "es"),
    nombre: (a, b) => a.name.localeCompare(b.name, "es"),
    precio: (a, b) => (a.price || 0) - (b.price || 0),
    cantidad: (a, b) => a.quantity - b.quantity,
    estado: (a, b) => a.status.localeCompare(b.status, "es"),
  };
  return items.sort(sorters[state.sort] || sorters.id);
}

function selectOptions(values, current, placeholder) {
  return [`<option value="">${placeholder}</option>`]
    .concat(values.map((value) => `<option ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`))
    .join("");
}

function renderInventory() {
  const data = store.data();
  const items = filteredItems();
  view.innerHTML = `
    <div class="toolbar">
      <label class="wide">Buscar
        <input id="query" type="search" value="${escapeHtml(state.query)}" placeholder="ID, artículo, descripción, ambiente o categoría">
      </label>
      <label>Ambiente
        <select id="filter-room">${selectOptions(data.rooms.map((room) => room.name), state.room, "Todos")}</select>
      </label>
      <label>Categoría
        <select id="filter-category">${selectOptions(data.categories, state.category, "Todas")}</select>
      </label>
      <label>Estado
        <select id="filter-status">${selectOptions(store.SALE_STATUSES, state.status, "Todos")}</select>
      </label>
      <label>Publicación
        <select id="filter-published">
          <option value="">Todas</option>
          <option value="si" ${state.published === "si" ? "selected" : ""}>Publicado</option>
          <option value="no" ${state.published === "no" ? "selected" : ""}>No publicado</option>
        </select>
      </label>
      <label>Orden
        <select id="sort">
          ${[["id", "ID"], ["nombre", "Nombre"], ["precio", "Precio"], ["cantidad", "Cantidad"], ["estado", "Estado"]].map(([key, label]) => `<option value="${key}" ${state.sort === key ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <button class="primary" id="new-item" type="button">Nuevo objeto</button>
    </div>
    <p class="lede">${items.length} registros</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>ID</th><th>Foto</th><th>Ambiente</th><th>Categoría</th><th>Artículo</th><th>Descripción</th>
        <th>Cantidad</th><th>Medidas</th><th>Estado</th><th>Precio publicado</th><th>Publicar</th><th>Acciones</th>
      </tr></thead>
      <tbody>
        ${items.map((item) => `<tr>
          <td data-label="ID">${escapeHtml(item.id)}</td>
          <td data-label="Foto">${photoCell(item)}</td>
          <td data-label="Ambiente">${escapeHtml(item.room)}</td>
          <td data-label="Categoría">${escapeHtml(item.category)}</td>
          <td data-label="Artículo">${escapeHtml(item.name)}</td>
          <td data-label="Descripción">${escapeHtml(item.description)}</td>
          <td data-label="Cantidad">${item.quantity}</td>
          <td data-label="Medidas">${escapeHtml(item.measures)}</td>
          <td data-label="Estado">${escapeHtml(item.status)}</td>
          <td data-label="Precio publicado">${price(item.price)}</td>
          <td data-label="Publicar">${item.published ? "Sí" : "No"}</td>
          <td data-label="Acciones"><div class="actions">
            <button class="small" data-action="ver" data-id="${item.id}" type="button">Ver</button>
            <button class="small" data-action="editar" data-id="${item.id}" type="button">Editar</button>
            <button class="small" data-action="duplicar" data-id="${item.id}" type="button">Duplicar</button>
            <button class="small" data-action="estado" data-id="${item.id}" type="button">Cambiar estado</button>
            <button class="small danger" data-action="eliminar" data-id="${item.id}" type="button">Eliminar</button>
          </div></td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function renderCatalog() {
  const items = store.catalogItems();
  view.innerHTML = `
    <p class="lede">Solo entran los objetos publicados que no están vendidos, retirados ni marcados como no vender.</p>
    <div class="catalog-grid">
      ${items.map((item) => `<article class="catalog-card">
        ${item.image ? `<img src="${asset(item.image)}" alt="${escapeHtml(item.name)}">` : `<div class="placeholder">Sin foto</div>`}
        <div>
          <p class="eyebrow">${escapeHtml(item.room)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <p>Cantidad disponible: ${item.quantity}</p>
          <p>${price(item.price)}</p>
          <button class="small" data-action="despublicar" data-id="${item.id}" type="button">Quitar del catálogo</button>
        </div>
      </article>`).join("") || `<p class="lede">No hay objetos publicados.</p>`}
    </div>`;
}

function renderSales() {
  const rows = store.sales();
  view.innerHTML = `
    <p class="lede">Las ventas quedan en el historial. El objeto no se borra.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Artículo</th><th>Ambiente</th><th>Cantidad</th><th>Precio publicado</th><th>Precio vendido</th><th>Diferencia</th><th>Estado</th><th>Fecha</th><th>Observaciones</th></tr></thead>
      <tbody>
        ${rows.map((sale) => `<tr>
          <td data-label="ID">${escapeHtml(sale.id)}</td>
          <td data-label="Artículo">${escapeHtml(sale.name)}</td>
          <td data-label="Ambiente">${escapeHtml(sale.room)}</td>
          <td data-label="Cantidad">${sale.quantity}</td>
          <td data-label="Precio publicado">${price(sale.price)}</td>
          <td data-label="Precio vendido">${price(sale.soldPrice)}</td>
          <td data-label="Diferencia">${sale.soldPrice == null ? "—" : price(sale.difference)}</td>
          <td data-label="Estado">${escapeHtml(sale.status)}</td>
          <td data-label="Fecha">${escapeHtml(sale.soldAt)}</td>
          <td data-label="Observaciones">${escapeHtml(sale.saleNotes)}</td>
        </tr>`).join("") || `<tr><td>Todavía no hay ventas.</td></tr>`}
      </tbody>
    </table></div>`;
}

function renderSummary() {
  const stats = store.metrics();
  const byName = store.summaryByName();
  const byRoom = store.summaryByRoom();
  view.innerHTML = `
    <section class="cards">
      ${metric("Total de registros", stats.loaded)}
      ${metric("Total de unidades", stats.units)}
      ${metric("Valor total publicado", price(stats.publishedValue))}
      ${metric("Valor disponible", price(stats.availableValue))}
      ${metric("Valor reservado", price(stats.reservedValue))}
      ${metric("Valor vendido", price(stats.soldValue))}
    </section>
    <section class="panel">
      <h2>Objeto y cantidad</h2>
      <p class="lede">Se suman las cantidades de cada registro con el mismo nombre.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Objeto</th><th>Cantidad</th></tr></thead>
        <tbody>${byName.map((row) => `<tr><td data-label="Objeto">${escapeHtml(row.name)}</td><td data-label="Cantidad">${row.quantity}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>
    <section class="panel">
      <h2>Resumen por ambiente</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Ambiente</th><th>Registros</th><th>Unidades</th><th>Disponibles</th><th>Vendidos</th><th>Valor publicado</th></tr></thead>
        <tbody>${byRoom.map((row) => `<tr>
          <td data-label="Ambiente">${escapeHtml(row.room)}</td>
          <td data-label="Registros">${row.records}</td>
          <td data-label="Unidades">${row.units}</td>
          <td data-label="Disponibles">${row.available}</td>
          <td data-label="Vendidos">${row.sold}</td>
          <td data-label="Valor publicado">${price(row.publishedValue)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

function renderRooms() {
  view.innerHTML = `
    <form id="room-form" class="toolbar">
      <label>Nuevo ambiente<input name="name" required></label>
      <button class="primary" type="submit">Crear ambiente</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Ambiente</th><th>Objetos</th><th>Acciones</th></tr></thead>
      <tbody>${store.data().rooms.map((room) => {
        const count = store.data().items.filter((item) => item.room === room.name).length;
        return `<tr>
          <td data-label="Ambiente">${escapeHtml(room.name)}</td>
          <td data-label="Objetos">${count}</td>
          <td data-label="Acciones"><div class="actions">
            <button class="small" data-room-edit="${room.slug}" type="button">Editar</button>
            <button class="small danger" data-room-delete="${room.slug}" type="button">Eliminar</button>
          </div></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

function renderCategories() {
  view.innerHTML = `
    <form id="category-form" class="toolbar">
      <label>Nueva categoría<input name="name" required></label>
      <button class="primary" type="submit">Crear categoría</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Categoría</th><th>Objetos</th><th>Acciones</th></tr></thead>
      <tbody>${store.data().categories.map((name) => {
        const count = store.data().items.filter((item) => item.category === name).length;
        return `<tr>
          <td data-label="Categoría">${escapeHtml(name)}</td>
          <td data-label="Objetos">${count}</td>
          <td data-label="Acciones"><div class="actions">
            <button class="small" data-category-edit="${escapeHtml(name)}" type="button">Editar</button>
            <button class="small danger" data-category-delete="${escapeHtml(name)}" type="button">Eliminar</button>
          </div></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

function renderHistory() {
  const rows = store.history();
  view.innerHTML = `
    <p class="lede">Queda preparado para registrar después qué usuario hizo cada cambio.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Objeto</th><th>Acción</th><th>Valor anterior</th><th>Valor nuevo</th><th>Usuario</th></tr></thead>
      <tbody>${rows.map((entry) => `<tr>
        <td data-label="Fecha">${new Date(entry.at).toLocaleString("es-AR")}</td>
        <td data-label="Objeto">${escapeHtml(entry.itemName || entry.itemId)}</td>
        <td data-label="Acción">${escapeHtml(entry.action)}</td>
        <td data-label="Valor anterior">${escapeHtml(entry.before)}</td>
        <td data-label="Valor nuevo">${escapeHtml(entry.after)}</td>
        <td data-label="Usuario">${escapeHtml(entry.user || "—")}</td>
      </tr>`).join("") || `<tr><td>Todavía no hay cambios registrados.</td></tr>`}</tbody>
    </table></div>`;
}

function renderSettings() {
  view.innerHTML = `
    <section class="panel">
      <h2>Este dispositivo</h2>
      <p class="lede">El Modo Anfitrión abre directo, sin usuario ni contraseña. Los cambios del inventario se guardan en este navegador y el catálogo público de esta misma computadora los toma al recargar.</p>
      <div class="actions">
        <button class="small" id="export-data" type="button">Descargar copia</button>
        <label class="small">Importar copia<input id="import-data" type="file" accept="application/json"></label>
      </div>
    </section>`;
}

const RENDER = {
  dashboard: renderDashboard,
  inventario: renderInventory,
  catalogo: renderCatalog,
  ventas: renderSales,
  resumen: renderSummary,
  ambientes: renderRooms,
  categorias: renderCategories,
  historial: renderHistory,
  configuracion: renderSettings,
};

function render() {
  renderNav();
  (RENDER[state.view] || renderDashboard)();
}

function formField(label, name, value, type = "text") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}"></label>`;
}

function openEditor(item, readOnly) {
  const data = store.data();
  const current = item || {
    id: "",
    room: data.rooms[0] ? data.rooms[0].name : "",
    category: data.categories[0] || "",
    name: "",
    description: "",
    quantity: 1,
    measures: "",
    condition: "",
    price: "",
    status: "Disponible",
    published: true,
    images: [],
    notes: "",
    soldPrice: "",
    soldAt: "",
    saleNotes: "",
  };
  const photos = current.images || [];
  document.querySelector("#editor-form").innerHTML = `
    <header>
      <h2>${readOnly ? "Ver objeto" : item ? "Editar objeto" : "Nuevo objeto"}</h2>
      <button class="small" type="button" id="close-editor">Cerrar</button>
    </header>
    <div class="form-grid">
      ${formField("ID", "id", current.id)}
      <label>Ambiente<select name="room">${data.rooms.map((room) => `<option ${room.name === current.room ? "selected" : ""}>${escapeHtml(room.name)}</option>`).join("")}</select></label>
      <label>Categoría<select name="category">${data.categories.map((name) => `<option ${name === current.category ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}<option value="__nueva">Nueva categoría…</option></select></label>
      ${formField("Nueva categoría", "newCategory", "")}
      ${formField("Artículo", "name", current.name)}
      <label class="wide">Descripción<textarea name="description">${escapeHtml(current.description)}</textarea></label>
      ${formField("Cantidad", "quantity", current.quantity, "number")}
      ${formField("Medidas", "measures", current.measures)}
      <label>Estado<select name="status">${store.SALE_STATUSES.map((status) => `<option ${status === current.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      ${formField("Detalle", "condition", current.condition)}
      ${formField("Precio publicado", "price", current.price, "number")}
      <label class="check"><input name="published" type="checkbox" ${current.published ? "checked" : ""}> Publicar</label>
      ${formField("Precio vendido", "soldPrice", current.soldPrice, "number")}
      ${formField("Fecha de venta", "soldAt", current.soldAt, "date")}
      <label class="wide">Observaciones<textarea name="notes">${escapeHtml(current.notes)}</textarea></label>
      <label class="wide">Observaciones de la venta<textarea name="saleNotes">${escapeHtml(current.saleNotes)}</textarea></label>
      <label class="wide">Fotos<input id="photo-input" type="file" accept="image/*" multiple></label>
      <div class="photos wide" id="photo-list"></div>
    </div>
    <p id="editor-error" class="error" hidden></p>
    <button class="primary" type="submit">Guardar</button>`;
  const draft = { ...current, images: [...photos] };
  const list = document.querySelector("#photo-list");
  const paintPhotos = () => {
    list.innerHTML = draft.images.map((src, index) => `<div class="photo">
      <img src="${asset(src)}" alt="Foto ${index + 1}">
      <div class="actions">
        ${readOnly ? (index === 0 ? `<span class="small">Principal</span>` : "") : `<button class="small" type="button" data-cover="${index}">${index === 0 ? "Principal" : "Hacer principal"}</button>
        <button class="small danger" type="button" data-remove-photo="${index}">Quitar</button>`}
      </div>
    </div>`).join("");
  };
  paintPhotos();
  list.addEventListener("click", (event) => {
    const cover = event.target.closest("[data-cover]");
    const remove = event.target.closest("[data-remove-photo]");
    if (cover) {
      const index = Number(cover.dataset.cover);
      const [photo] = draft.images.splice(index, 1);
      draft.images.unshift(photo);
      paintPhotos();
    }
    if (remove) {
      draft.images.splice(Number(remove.dataset.removePhoto), 1);
      paintPhotos();
    }
  });
  document.querySelector("#photo-input").addEventListener("change", async (event) => {
    const error = document.querySelector("#editor-error");
    try {
      for (const file of event.target.files) {
        draft.images.push(await optimizePhoto(file));
      }
      error.hidden = true;
    } catch (failure) {
      error.hidden = false;
      error.textContent = failure.message;
    }
    event.target.value = "";
    paintPhotos();
  });
  if (readOnly) {
    document.querySelectorAll("#editor-form input, #editor-form select, #editor-form textarea").forEach((field) => {
      field.disabled = true;
    });
    document.querySelector("#photo-input").closest("label").hidden = true;
    document.querySelector("#editor-form button.primary").hidden = true;
  }
  document.querySelector("#close-editor").addEventListener("click", () => editor.close());
  document.querySelector("#editor-form").onsubmit = (event) => {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    const error = document.querySelector("#editor-error");
    try {
      const category = form.get("category") === "__nueva" ? String(form.get("newCategory") || "") : String(form.get("category") || "");
      const payload = {
        id: String(form.get("id") || "").trim(),
        room: String(form.get("room") || ""),
        category,
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        quantity: Number(form.get("quantity")),
        measures: String(form.get("measures") || "").trim(),
        condition: String(form.get("condition") || "").trim(),
        price: form.get("price") === "" ? null : Number(form.get("price")),
        status: String(form.get("status")),
        published: form.get("published") === "on",
        notes: String(form.get("notes") || "").trim(),
        soldPrice: form.get("soldPrice") === "" ? null : Number(form.get("soldPrice")),
        soldAt: String(form.get("soldAt") || ""),
        saleNotes: String(form.get("saleNotes") || "").trim(),
        images: draft.images,
      };
      if (!payload.name) throw new Error("El artículo es obligatorio.");
      if (!payload.room) throw new Error("Elegí un ambiente.");
      if (!payload.category) throw new Error("Elegí o escribí una categoría.");
      if (!Number.isInteger(payload.quantity) || payload.quantity < 1) throw new Error("La cantidad debe ser un entero mayor a cero.");
      if (payload.price != null && (Number.isNaN(payload.price) || payload.price < 0)) throw new Error("El precio publicado no es válido.");
      if (item) store.updateItem(item.id, payload);
      else store.createItem(payload);
      editor.close();
      render();
    } catch (failure) {
      error.hidden = false;
      error.textContent = failure.message;
    }
  };
  editor.showModal();
}

function bindInventory(event) {
  const target = event.target;
  if (target.id === "query") {
    state.query = target.value;
    const caret = target.selectionStart;
    renderInventory();
    const field = document.querySelector("#query");
    if (field) {
      field.focus();
      field.setSelectionRange(caret, caret);
    }
    return;
  }
  if (target.id === "filter-room") state.room = target.value;
  if (target.id === "filter-category") state.category = target.value;
  if (target.id === "filter-status") state.status = target.value;
  if (target.id === "filter-published") state.published = target.value;
  if (target.id === "sort") state.sort = target.value;
  if (["filter-room", "filter-category", "filter-status", "filter-published", "sort"].includes(target.id)) {
    renderInventory();
  }
  if (target.id === "new-item") openEditor(null, false);
  const button = target.closest("[data-action]");
  if (!button) return;
  const item = store.data().items.find((entry) => entry.id === button.dataset.id);
  if (button.dataset.action === "ver") openEditor(item, true);
  if (button.dataset.action === "editar") openEditor(item, false);
  if (button.dataset.action === "duplicar") run(() => store.duplicateItem(item.id));
  if (button.dataset.action === "eliminar") {
    if (window.confirm(`¿Eliminar ${item.name}?`)) run(() => store.deleteItem(item.id));
  }
  if (button.dataset.action === "estado") {
    const status = window.prompt(`Estado de ${item.name} (${store.SALE_STATUSES.join(", ")})`, item.status);
    if (status && store.SALE_STATUSES.includes(status)) run(() => store.updateItem(item.id, { status }));
    else if (status) showError(new Error("Ese estado no está disponible."));
  }
  if (button.dataset.action === "despublicar") run(() => store.updateItem(item.id, { published: false }));
}

function bindView(event) {
  if (state.view === "inventario" || state.view === "catalogo") bindInventory(event);
  if (event.target.id === "room-form" || event.target.closest("#room-form")) return;
  const editRoom = event.target.closest("[data-room-edit]");
  const deleteRoom = event.target.closest("[data-room-delete]");
  const editCategory = event.target.closest("[data-category-edit]");
  const deleteCategory = event.target.closest("[data-category-delete]");
  if (editRoom) {
    const room = store.data().rooms.find((entry) => entry.slug === editRoom.dataset.roomEdit);
    const name = window.prompt("Nombre del ambiente", room.name);
    if (name) run(() => store.updateRoom(room.slug, name));
  }
  if (deleteRoom && window.confirm("¿Eliminar este ambiente?")) run(() => store.deleteRoom(deleteRoom.dataset.roomDelete));
  if (editCategory) {
    const name = window.prompt("Nombre de la categoría", editCategory.dataset.categoryEdit);
    if (name) run(() => store.updateCategory(editCategory.dataset.categoryEdit, name));
  }
  if (deleteCategory && window.confirm("¿Eliminar esta categoría?")) run(() => store.deleteCategory(deleteCategory.dataset.categoryDelete));
  if (event.target.id === "export-data") {
    const blob = new Blob([store.exportData()], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "inventario-la-taba.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

view.addEventListener("input", bindView);
view.addEventListener("change", (event) => {
  if (event.target.id === "import-data" && event.target.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importData(String(reader.result));
        render();
      } catch (error) {
        showError(error);
      }
    };
    reader.readAsText(event.target.files[0]);
  }
  bindView(event);
});
view.addEventListener("click", bindView);
view.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  if (event.target.id === "room-form") run(() => store.createRoom(String(form.get("name") || "")));
  if (event.target.id === "category-form") run(() => store.createCategory(String(form.get("name") || "")));
});

document.querySelector("#nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  document.querySelector("#sidebar").classList.remove("open");
  render();
});
document.querySelector("#menu").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.toggle("open");
});
document.querySelector("#logout").addEventListener("click", () => {
  location.href = "/";
});

render();
