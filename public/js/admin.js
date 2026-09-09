const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('password');
const logoutBtn = document.getElementById('logout-btn');
const exportBtn = document.getElementById('export-btn');
const newCarBtn = document.getElementById('new-car-btn');
const adminQInput = document.getElementById('admin-q');
const adminCategoryFiltersEl = document.getElementById('admin-category-filters');
const adminCountEl = document.getElementById('admin-count');
const carTbody = document.getElementById('car-tbody');
const globalNewCategoryInput = document.getElementById('global-new-category');
const globalAddCategoryBtn = document.getElementById('global-add-category-btn');
const toolbarError = document.getElementById('toolbar-error');
const adminTabsEl = document.getElementById('admin-tabs');

let token = sessionStorage.getItem('spawnfluxo_token') || '';
let cars = [];
let allCategories = [];
let selectedCategories = new Set();
let editingId = null; // null = ninguém sendo editado; 'new' = criando; ou o id do carro em edição
let debounceTimer;
let currentType = 'veiculo';

function wordFor(plural) {
  if (currentType === 'item') return plural ? 'itens' : 'item';
  return plural ? 'carros' : 'carro';
}

adminTabsEl.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.type === currentType) return;
    currentType = btn.dataset.type;
    adminTabsEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    newCarBtn.textContent = currentType === 'item' ? '+ Novo item' : '+ Novo carro';
    editingId = null;
    selectedCategories = new Set();
    toolbarError.hidden = true;
    try {
      await loadCategories();
      await loadCars();
    } catch (err) {
      toolbarError.textContent = err.message;
      toolbarError.hidden = false;
    }
  });
});

// Segura tanto para texto quanto para dentro de atributos "...": também
// escapa aspas, já que div.innerHTML por si só não as escapa.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function authFetch(url, options = {}) {
  options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + token });
  const res = await fetch(url, options);
  if (res.status === 401) {
    logout();
    throw new Error('Sessão expirada, faça login novamente.');
  }
  return res;
}

async function showAdmin() {
  loginSection.hidden = true;
  adminSection.hidden = false;
  // "+ Novo carro" fica desabilitado até o carregamento inicial terminar:
  // o checklist de categorias depende de allCategories, e um loadCars()
  // ainda em andamento re-renderizaria a tabela por cima de uma edição
  // recém-aberta, apagando o que já tivesse sido digitado.
  newCarBtn.disabled = true;
  try {
    await loadCategories();
    await loadCars();
  } catch (err) {
    toolbarError.textContent = err.message;
    toolbarError.hidden = false;
  } finally {
    newCarBtn.disabled = false;
  }
}

function logout() {
  token = '';
  sessionStorage.removeItem('spawnfluxo_token');
  loginSection.hidden = false;
  adminSection.hidden = true;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Senha incorreta');
    }
    const data = await res.json();
    token = data.token;
    sessionStorage.setItem('spawnfluxo_token', token);
    passwordInput.value = '';
    showAdmin();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await authFetch('/api/logout', { method: 'POST' });
  } catch {
    /* sessão já pode ter expirado */
  }
  logout();
});

newCarBtn.addEventListener('click', () => {
  editingId = 'new';
  renderTable();
});

exportBtn.addEventListener('click', async () => {
  toolbarError.hidden = true;
  try {
    const res = await authFetch('/api/export?type=' + currentType);
    if (!res.ok) throw new Error('Não foi possível gerar o backup.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentType === 'item' ? 'spawnfluxo-backup-itens.txt' : 'spawnfluxo-backup-veiculos.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toolbarError.textContent = err.message;
    toolbarError.hidden = false;
  }
});

function loadCarsSafely() {
  loadCars().catch((err) => {
    toolbarError.textContent = err.message;
    toolbarError.hidden = false;
  });
}

adminQInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadCarsSafely, 250);
});

async function loadCategories() {
  const res = await fetch('/api/categories?type=' + currentType);
  if (!res.ok) throw new Error('Não foi possível carregar as categorias.');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar categorias.');
  allCategories = data;
  // remove da seleção categorias que não existem mais (ex.: acabaram de ser excluídas)
  for (const cat of [...selectedCategories]) {
    if (!allCategories.includes(cat)) selectedCategories.delete(cat);
  }
  renderCategoryFilters();
}

function renderCategoryFilters() {
  adminCategoryFiltersEl.innerHTML = allCategories
    .map(
      (cat) => `
    <button type="button" class="category-chip${selectedCategories.has(cat) ? ' active' : ''}" data-cat="${escapeHtml(cat)}">
      <span class="chip-label">${escapeHtml(cat)}</span>
      <span class="category-chip-edit" data-cat="${escapeHtml(cat)}" title="Renomear categoria">&#9998;</span>
      <span class="category-chip-delete" data-cat="${escapeHtml(cat)}" title="Excluir categoria">&times;</span>
    </button>
  `
    )
    .join('');

  adminCategoryFiltersEl.querySelectorAll('.category-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      btn.classList.toggle('active');
      loadCarsSafely();
    });
  });

  adminCategoryFiltersEl.querySelectorAll('.category-chip-edit').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const input = prompt('Novo nome para a categoria:', cat);
      if (input === null) return;
      const newName = input.trim();
      if (!newName || newName === cat) return;
      toolbarError.hidden = true;
      try {
        const res = await authFetch('/api/categories/' + currentType + '/' + encodeURIComponent(cat), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao renomear categoria');
        }
        if (selectedCategories.has(cat)) {
          selectedCategories.delete(cat);
          selectedCategories.add(newName);
        }
        await loadCategories();
        await loadCars();
      } catch (err) {
        toolbarError.textContent = err.message;
        toolbarError.hidden = false;
      }
    });
  });

  adminCategoryFiltersEl.querySelectorAll('.category-chip-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      if (!confirm(`Excluir a categoria "${cat}"? Os ${wordFor(true)} nela ficarão sem essa categoria (não serão excluídos).`)) return;
      toolbarError.hidden = true;
      try {
        const res = await authFetch('/api/categories/' + currentType + '/' + encodeURIComponent(cat), { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao excluir categoria');
        }
        selectedCategories.delete(cat);
        await loadCategories();
        await loadCars();
      } catch (err) {
        toolbarError.textContent = err.message;
        toolbarError.hidden = false;
      }
    });
  });
}

// Atualiza só o checklist de categorias da linha em edição (se houver),
// sem re-renderizar a tabela toda (o que apagaria o resto do formulário).
function refreshOpenChecklist() {
  const checklistEl = carTbody.querySelector('.editing-row .categories-checklist');
  if (!checklistEl) return;
  const checkedNow = Array.from(checklistEl.querySelectorAll('input:checked')).map((cb) => cb.value);
  checklistEl.innerHTML = checklistItemsHtml(allCategories, checkedNow);
}

globalAddCategoryBtn.addEventListener('click', async () => {
  const name = globalNewCategoryInput.value.trim();
  if (!name) return;
  toolbarError.hidden = true;
  try {
    const res = await authFetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: currentType }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ao criar categoria');
    }
    await loadCategories();
    refreshOpenChecklist();
    globalNewCategoryInput.value = '';
  } catch (err) {
    toolbarError.textContent = err.message;
    toolbarError.hidden = false;
  }
});

async function loadCars() {
  const params = new URLSearchParams();
  params.set('type', currentType);
  if (adminQInput.value.trim()) params.set('q', adminQInput.value.trim());
  selectedCategories.forEach((cat) => params.append('category', cat));
  const res = await fetch('/api/cars?' + params.toString());
  if (!res.ok) throw new Error('Não foi possível carregar os carros.');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar os carros.');
  cars = data;
  renderTable();
}

function emptyCar() {
  return { id: '', name: '', spawnCode: '', categories: [], photoUrl: '' };
}

function checklistItemsHtml(categories, checked) {
  return categories
    .map(
      (cat) => `
    <label class="chk">
      <input type="checkbox" value="${escapeHtml(cat)}" ${checked.includes(cat) ? 'checked' : ''}>
      <span>${escapeHtml(cat)}</span>
    </label>
  `
    )
    .join('');
}

function editRowHtml(car) {
  const c = car || emptyCar();
  return `
    <tr data-id="${c.id}" class="editing-row">
      <td colspan="5">
        <div class="inline-form">
          <div class="inline-fields">
            <label>Nome do ${wordFor(false)}
              <input type="text" class="f-name" value="${escapeHtml(c.name)}" maxlength="200">
            </label>
            <label>Código de spawn
              <input type="text" class="f-spawnCode" value="${escapeHtml(c.spawnCode)}" maxlength="100">
            </label>
            <label>Foto — URL (https://)
              <input type="url" class="f-photoUrl" value="${escapeHtml(c.photoUrl)}" placeholder="https://..." maxlength="2000">
            </label>
          </div>
          <div class="categories-field">
            <span class="field-label">Categorias (marque uma ou mais — para criar uma nova, use "+ Nova categoria" no topo da página)</span>
            <div class="categories-checklist">${checklistItemsHtml(allCategories, c.categories)}</div>
          </div>
          <img class="inline-preview" ${c.photoUrl ? `src="${escapeHtml(c.photoUrl)}"` : 'hidden'}>
          <div class="inline-actions">
            <button type="button" class="save-inline-btn">Salvar</button>
            <button type="button" class="cancel-inline-btn secondary">Cancelar</button>
          </div>
          <p class="inline-error error" hidden></p>
        </div>
      </td>
    </tr>
  `;
}

function viewRowHtml(car) {
  const categoriesHtml = car.categories.length
    ? `<div class="car-categories">${car.categories.map((cat) => `<span class="car-category">${escapeHtml(cat)}</span>`).join('')}</div>`
    : '—';
  return `
    <tr data-id="${car.id}">
      <td data-label="Foto">${car.photoUrl ? `<img src="${escapeHtml(car.photoUrl)}" class="thumb">` : '—'}</td>
      <td data-label="Nome">${escapeHtml(car.name)}</td>
      <td data-label="Código"><code>${escapeHtml(car.spawnCode)}</code></td>
      <td data-label="Categoria">${categoriesHtml}</td>
      <td data-label="Ações">
        <button data-id="${car.id}" class="edit-btn secondary">Editar</button>
        <button data-id="${car.id}" class="delete-btn danger">Excluir</button>
      </td>
    </tr>
  `;
}

function renderTable() {
  adminCountEl.textContent = cars.length + ' ' + wordFor(cars.length !== 1) + (cars.length === 1 ? ' encontrado' : ' encontrados');

  let rowsHtml = '';
  if (editingId === 'new') rowsHtml += editRowHtml(null);
  for (const car of cars) {
    rowsHtml += editingId === car.id ? editRowHtml(car) : viewRowHtml(car);
  }
  carTbody.innerHTML = rowsHtml;
  attachRowHandlers();
}

function attachRowHandlers() {
  carTbody.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingId = btn.dataset.id;
      renderTable();
    });
  });

  carTbody.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const car = cars.find((c) => c.id === btn.dataset.id);
      if (!confirm(`Excluir "${car.name}"?`)) return;
      try {
        const res = await authFetch('/api/cars/' + btn.dataset.id, { method: 'DELETE' });
        if (res.ok) {
          await loadCars();
          await loadCategories();
        }
      } catch (err) {
        toolbarError.textContent = err.message;
        toolbarError.hidden = false;
      }
    });
  });

  carTbody.querySelectorAll('.cancel-inline-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingId = null;
      renderTable();
    });
  });

  carTbody.querySelectorAll('.editing-row').forEach((row) => {
    const photoInput = row.querySelector('.f-photoUrl');
    const preview = row.querySelector('.inline-preview');
    photoInput.addEventListener('input', () => {
      if (photoInput.value) {
        preview.src = photoInput.value;
        preview.hidden = false;
      } else {
        preview.hidden = true;
      }
    });

    const checklistEl = row.querySelector('.categories-checklist');
    const errorEl = row.querySelector('.inline-error');

    const saveBtn = row.querySelector('.save-inline-btn');
    saveBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
      try {
        const categories = Array.from(checklistEl.querySelectorAll('input:checked')).map((cb) => cb.value);
        const payload = {
          type: currentType,
          name: row.querySelector('.f-name').value.trim(),
          spawnCode: row.querySelector('.f-spawnCode').value.trim(),
          categories,
          photoUrl: row.querySelector('.f-photoUrl').value.trim(),
        };

        const id = row.dataset.id;
        const res = id
          ? await authFetch('/api/cars/' + id, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await authFetch('/api/cars', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao salvar');
        }

        editingId = null;
        await loadCategories();
        await loadCars();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    });
  });
}

if (token) {
  showAdmin();
}
