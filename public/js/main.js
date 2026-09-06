const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const qEl = document.getElementById('q');
const categoryEl = document.getElementById('category');

let debounceTimer;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function loadCategories() {
  const res = await fetch('/api/categories');
  const categories = await res.json();
  const current = categoryEl.value;
  categoryEl.innerHTML =
    '<option value="">Todas as categorias</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (categories.includes(current)) categoryEl.value = current;
}

async function loadCars() {
  const params = new URLSearchParams();
  if (qEl.value.trim()) params.set('q', qEl.value.trim());
  if (categoryEl.value) params.set('category', categoryEl.value);
  const res = await fetch('/api/cars?' + params.toString());
  const cars = await res.json();
  renderCars(cars);
}

function renderCars(cars) {
  countEl.textContent = cars.length + (cars.length === 1 ? ' carro encontrado' : ' carros encontrados');
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
categoryEl.addEventListener('change', loadCars);

loadCategories();
loadCars();
