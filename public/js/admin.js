const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('password');
const logoutBtn = document.getElementById('logout-btn');
const newCarBtn = document.getElementById('new-car-btn');
const adminQInput = document.getElementById('admin-q');
const adminCategorySelect = document.getElementById('admin-category');
const adminCountEl = document.getElementById('admin-count');
const carTbody = document.getElementById('car-tbody');

let token = sessionStorage.getItem('spawnfluxo_token') || '';
let cars = [];
let allCategories = [];
let editingId = null; // null = ninguém sendo editado; 'new' = criando; ou o id do carro em edição
let debounceTimer;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
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
  await loadCategories();
  await loadCars();
  newCarBtn.disabled = false;
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

adminQInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadCars, 250);
});
adminCategorySelect.addEventListener('change', loadCars);

async function loadCategories() {
  const res = await fetch('/api/categories');
  allCategories = await res.json();
  const current = adminCategorySelect.value;
  adminCategorySelect.innerHTML =
    '<option value="">Todas as categorias</option>' +
    allCategories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if (allCategories.includes(current)) adminCategorySelect.value = current;
}

async function loadCars() {
  const params = new URLSearchParams();
  if (adminQInput.value.trim()) params.set('q', adminQInput.value.trim());
  if (adminCategorySelect.value) params.set('category', adminCategorySelect.value);
  const res = await fetch('/api/cars?' + params.toString());
  cars = await res.json();
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
      <input type="checkbox" value="${escapeAttr(cat)}" ${checked.includes(cat) ? 'checked' : ''}>
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
            <label>Nome do carro
              <input type="text" class="f-name" value="${escapeAttr(c.name)}">
            </label>
            <label>Código de spawn
              <input type="text" class="f-spawnCode" value="${escapeAttr(c.spawnCode)}">
            </label>
            <label>Foto — URL (https://)
              <input type="url" class="f-photoUrl" value="${escapeAttr(c.photoUrl)}" placeholder="https://...">
            </label>
          </div>
          <div class="categories-field">
            <span class="field-label">Categorias (marque uma ou mais)</span>
            <div class="categories-checklist">${checklistItemsHtml(allCategories, c.categories)}</div>
            <div class="add-category-row">
              <input type="text" class="new-category-input" placeholder="Nova categoria...">
              <button type="button" class="add-category-btn secondary">+ Adicionar categoria</button>
            </div>
          </div>
          <img class="inline-preview" ${c.photoUrl ? `src="${escapeAttr(c.photoUrl)}"` : 'hidden'}>
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
  adminCountEl.textContent = cars.length + (cars.length === 1 ? ' carro encontrado' : ' carros encontrados');

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
      const res = await authFetch('/api/cars/' + btn.dataset.id, { method: 'DELETE' });
      if (res.ok) {
        await loadCars();
        await loadCategories();
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
    const newCatInput = row.querySelector('.new-category-input');
    const addCatBtn = row.querySelector('.add-category-btn');
    const errorEl = row.querySelector('.inline-error');

    addCatBtn.addEventListener('click', async () => {
      const name = newCatInput.value.trim();
      if (!name) return;
      errorEl.hidden = true;
      try {
        const res = await authFetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao criar categoria');
        }
        const data = await res.json();
        await loadCategories();
        const checkedNow = Array.from(checklistEl.querySelectorAll('input:checked')).map((cb) => cb.value);
        if (!checkedNow.includes(data.name)) checkedNow.push(data.name);
        checklistEl.innerHTML = checklistItemsHtml(allCategories, checkedNow);
        newCatInput.value = '';
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    });

    const saveBtn = row.querySelector('.save-inline-btn');
    saveBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
      try {
        const categories = Array.from(checklistEl.querySelectorAll('input:checked')).map((cb) => cb.value);
        const payload = {
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
