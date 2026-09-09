const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const qEl = document.getElementById('q');
const categoryFiltersEl = document.getElementById('category-filters');
const loadErrorEl = document.getElementById('load-error');
const subtitleEl = document.getElementById('subtitle');
const tabsEl = document.getElementById('tabs');

let debounceTimer;
let selectedCategories = new Set();
let currentType = 'veiculo';

function wordFor(plural) {
  if (currentType === 'item') return plural ? 'itens' : 'item';
  return plural ? 'veículos' : 'veículo';
}

tabsEl.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.type === currentType) return;
    currentType = btn.dataset.type;
    tabsEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    subtitleEl.textContent =
      currentType === 'item' ? 'Catálogo de códigos de spawn de itens' : 'Catálogo de códigos de spawn de veículos';
    emptyEl.textContent = `Nenhum ${wordFor(false)} encontrado.`;
    selectedCategories = new Set();
    loadCategories();
    loadCars();
  });
});

// Segura tanto para texto quanto para dentro de atributos "...": também
// escapa aspas, já que div.innerHTML por si só não as escapa.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadCategories() {
  const res = await fetch('/api/categories?type=' + currentType);
  if (!res.ok) return; // filtro de categoria é só um extra; falha aqui não impede a busca
  const categories = await res.json();
  if (!Array.isArray(categories)) return;
  // remove da seleção categorias que não existem mais (ex.: excluídas no admin)
  for (const cat of [...selectedCategories]) {
    if (!categories.includes(cat)) selectedCategories.delete(cat);
  }
  renderCategoryFilters(categories);
}

function renderCategoryFilters(categories) {
  categoryFiltersEl.innerHTML = categories
    .map(
      (cat) =>
        `<button type="button" class="category-chip${selectedCategories.has(cat) ? ' active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    )
    .join('');
  categoryFiltersEl.querySelectorAll('.category-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      btn.classList.toggle('active');
      loadCars();
    });
  });
}

async function loadCars() {
  loadErrorEl.hidden = true;
  try {
    const params = new URLSearchParams();
    params.set('type', currentType);
    if (qEl.value.trim()) params.set('q', qEl.value.trim());
    selectedCategories.forEach((cat) => params.append('category', cat));
    const res = await fetch('/api/cars?' + params.toString());
    if (!res.ok) throw new Error('Não foi possível carregar o catálogo agora. Tente novamente em instantes.');
    const cars = await res.json();
    if (!Array.isArray(cars)) throw new Error('Resposta inválida do servidor.');
    renderCars(cars);
  } catch (err) {
    loadErrorEl.textContent = err.message;
    loadErrorEl.hidden = false;
  }
}

function renderCars(cars) {
  countEl.textContent = cars.length + ' ' + wordFor(cars.length !== 1) + (cars.length === 1 ? ' encontrado' : ' encontrados');
  emptyEl.hidden = cars.length !== 0;
  gridEl.innerHTML = cars
    .map(
      (car) => `
    <div class="card car-card">
      ${
        car.photoUrl
          ? `<img src="${escapeHtml(car.photoUrl)}" alt="${escapeHtml(car.name)}" class="car-photo">`
          : `<div class="car-photo placeholder">Sem foto</div>`
      }
      <div class="car-info">
        <h3>${escapeHtml(car.name)}</h3>
        <div class="car-categories">
          ${car.categories.map((cat) => `<span class="car-category">${escapeHtml(cat)}</span>`).join('')}
        </div>
        <p class="car-code">Código: <code>${escapeHtml(car.spawnCode)}</code></p>
      </div>
    </div>
  `
    )
    .join('');
}

qEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadCars, 250);
});

emptyEl.textContent = `Nenhum ${wordFor(false)} encontrado.`;
loadCategories();
loadCars();
