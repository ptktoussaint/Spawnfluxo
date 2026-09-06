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
const categoryList = document.getElementById('category-list');
const carTbody = document.getElementById('car-tbody');

let token = sessionStorage.getItem('spawnfluxo_token') || '';
let cars = [];
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

function showAdmin() {
  loginSection.hidden = true;
  adminSection.hidden = false;
  loadCategories();
  loadCars();
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
  const categories = await res.json();
  const current = adminCategorySelect.value;
  adminCategorySelect.innerHTML =
    '<option value="">Todas as categorias</option>' +
    categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if (categories.includes(current)) adminCategorySelect.value = current;
  categoryList.innerHTML = categories.map((c) => `<option value="${escapeAttr(c)}">`).join('');
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
  return { id: '', name: '', spawnCode: '', category: '', photoUrl: '' };
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
            <label>Categoria
              <input type="text" class="f-category" list="category-list" value="${escapeAttr(c.category)}">
            </label>
            <label>Foto — URL (https://)
              <input type="url" class="f-photoUrl" value="${escapeAttr(c.photoUrl)}" placeholder="https://...">
            </label>
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
  return `
    <tr data-id="${car.id}">
      <td data-label="Foto">${car.photoUrl ? `<img src="${escapeHtml(car.photoUrl)}" class="thumb">` : '—'}</td>
      <td data-label="Nome">${escapeHtml(car.name)}</td>
      <td data-label="Código"><code>${escapeHtml(car.spawnCode)}</code></td>
      <td data-label="Categoria">${escapeHtml(car.category)}</td>
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

    const saveBtn = row.querySelector('.save-inline-btn');
    saveBtn.addEventListener('click', async () => {
      const errorEl = row.querySelector('.inline-error');
      errorEl.hidden = true;
      try {
        const payload = {
          name: row.querySelector('.f-name').value.trim(),
          spawnCode: row.querySelector('.f-spawnCode').value.trim(),
          category: row.querySelector('.f-category').value.trim(),
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
