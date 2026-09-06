const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('password');
const logoutBtn = document.getElementById('logout-btn');
const newCarBtn = document.getElementById('new-car-btn');
const carFormWrap = document.getElementById('car-form-wrap');
const carForm = document.getElementById('car-form');
const cancelFormBtn = document.getElementById('cancel-form-btn');
const formTitle = document.getElementById('form-title');
const formError = document.getElementById('form-error');
const carIdInput = document.getElementById('car-id');
const nameInput = document.getElementById('name');
const spawnCodeInput = document.getElementById('spawnCode');
const categoryInput = document.getElementById('category');
const photoUrlInput = document.getElementById('photoUrl');
const photoPreview = document.getElementById('photo-preview');
const categoryList = document.getElementById('category-list');
const carTbody = document.getElementById('car-tbody');

let token = sessionStorage.getItem('spawnfluxo_token') || '';
let cars = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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

newCarBtn.addEventListener('click', () => openForm());
cancelFormBtn.addEventListener('click', () => closeForm());

function openForm(car) {
  carForm.reset();
  photoPreview.hidden = true;
  formError.hidden = true;
  if (car) {
    formTitle.textContent = 'Editar carro';
    carIdInput.value = car.id;
    nameInput.value = car.name;
    spawnCodeInput.value = car.spawnCode;
    categoryInput.value = car.category;
    photoUrlInput.value = car.photoUrl || '';
    if (car.photoUrl) {
      photoPreview.src = car.photoUrl;
      photoPreview.hidden = false;
    }
  } else {
    formTitle.textContent = 'Novo carro';
    carIdInput.value = '';
  }
  carFormWrap.hidden = false;
}

function closeForm() {
  carFormWrap.hidden = true;
  carForm.reset();
}

photoUrlInput.addEventListener('input', () => {
  if (photoUrlInput.value) {
    photoPreview.src = photoUrlInput.value;
    photoPreview.hidden = false;
  } else {
    photoPreview.hidden = true;
  }
});

carForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  try {
    const photoUrl = photoUrlInput.value.trim();

    const payload = {
      name: nameInput.value.trim(),
      spawnCode: spawnCodeInput.value.trim(),
      category: categoryInput.value.trim(),
      photoUrl,
    };

    const id = carIdInput.value;
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

    closeForm();
    await loadCategories();
    await loadCars();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  }
});

async function loadCategories() {
  const res = await fetch('/api/categories');
  const categories = await res.json();
  categoryList.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

async function loadCars() {
  const res = await fetch('/api/cars');
  cars = await res.json();
  carTbody.innerHTML = cars
    .map(
      (car) => `
    <tr>
      <td data-label="Foto">${car.photoUrl ? `<img src="${escapeHtml(car.photoUrl)}" class="thumb">` : '—'}</td>
      <td data-label="Nome">${escapeHtml(car.name)}</td>
      <td data-label="Código"><code>${escapeHtml(car.spawnCode)}</code></td>
      <td data-label="Categoria">${escapeHtml(car.category)}</td>
      <td data-label="Ações">
        <button data-id="${car.id}" class="edit-btn secondary">Editar</button>
        <button data-id="${car.id}" class="delete-btn danger">Excluir</button>
      </td>
    </tr>
  `
    )
    .join('');

  carTbody.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const car = cars.find((c) => c.id === btn.dataset.id);
      openForm(car);
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
}

if (token) {
  showAdmin();
}
