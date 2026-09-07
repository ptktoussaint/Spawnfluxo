const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const qEl = document.getElementById('q');
const categoryEl = document.getElementById('category');
const loadErrorEl = document.getElementById('load-error');

let debounceTimer;

// Segura tanto para texto quanto para dentro de atributos "...": também
// escapa aspas, já que div.innerHTML por si só não as escapa.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadCategories() {
  const res = await fetch('/api/categories');
  if (!res.ok) return; // filtro de categoria é só um extra; falha aqui não impede a busca
  const categories = await res.json();
  if (!Array.isArray(categories)) return;
  const current = categoryEl.value;
  categoryEl.innerHTML =
    '<option value="">Todas as categorias</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (categories.includes(current)) categoryEl.value = current;
}

async function loadCars() {
  loadErrorEl.hidden = true;
  try {
    const params = new URLSearchParams();
    if (qEl.value.trim()) params.set('q', qEl.value.trim());
    if (categoryEl.value) params.set('category', categoryEl.value);
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
