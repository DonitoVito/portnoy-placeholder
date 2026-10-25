export const PARTICLE_KEY = 'portnoy-placeholder-particles-v1';
const format = value => value.toLocaleString('ru-RU');
export function readParticleSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(PARTICLE_KEY));
    return {count: Number.isFinite(value?.count) ? Math.max(16384,Math.min(2097152,value.count)) : null,
      sizing: value?.sizing === 'fixed' ? 'fixed' : 'viktor'};
  } catch { return {count:null,sizing:'viktor'}; }
}
export function applyParticleSettings(engine, settings = readParticleSettings()) {
  engine.setParticleSizing(settings.sizing);
  return engine.setParticleCount(settings.count ?? engine.stats.maxParticles);
}
export function createParticleControls(container, onChange) {
  let value = readParticleSettings();
  let baseline = 262144;
  container.innerHTML = `
    <h2>Частицы жидкости</h2>
    <div class="particle-presets" aria-label="Количество частиц у Вити">
      <button type="button" data-count="65536">65 тыс.</button><button type="button" data-count="262144">260 тыс.</button>
      <button type="button" data-count="1048576">1 млн</button><button type="button" data-count="2097152">2 млн</button>
    </div>
    <label class="range-label" for="particle-amount"><span>Количество частиц</span><output id="particle-amount-value"></output></label>
    <input id="particle-amount" type="range" min="14" max="21" step="1" value="18" aria-describedby="particle-summary">
    <label class="check"><input id="particle-coupling" type="checkbox" checked>Меньше частиц — крупнее, как у Вити</label>
    <p id="particle-summary" class="note" role="status"></p>
    <p class="note">У Вити менялись и размер, и яркость. Сними галочку, чтобы сравнить с одинаковой крупностью. Ползунок позволяет уменьшить количество до 16 тысяч.</p>
    <div class="particle-presets"><button type="button" id="particle-save">Сохранить для страницы</button><button type="button" id="particle-reset">Исходное количество</button></div>
    <p id="particle-saved" class="note" role="status"></p>`;
  const $ = selector => container.querySelector(selector);
  function render(state) {
    if (state?.max) baseline = state.max;
    const count = value.count ?? baseline;
    $('#particle-amount').value = Math.log2(count);
    $('#particle-amount').setAttribute('aria-valuetext',format(count)+' частиц');
    $('#particle-amount-value').value = format(count);
    $('#particle-coupling').checked = value.sizing === 'viktor';
    for (const b of container.querySelectorAll('[data-count]')) b.setAttribute('aria-pressed',String(Number(b.dataset.count)===count));
    const ratio = state?.sizeRatio ?? (value.sizing === 'viktor' ? Math.pow(baseline/count,.25) : 1);
    $('#particle-summary').textContent = `${format(state?.count || count)} частиц · крупность ${ratio.toLocaleString('ru-RU',{maximumFractionDigits:2})}× от исходной для этого окна.`;
  }
  function change() { $('#particle-saved').textContent='';render();onChange({...value}); }
  for (const b of container.querySelectorAll('[data-count]')) b.addEventListener('click',()=>{value.count=Number(b.dataset.count);change();});
  $('#particle-amount').addEventListener('input',()=>{value.count=2**Number($('#particle-amount').value);change();});
  $('#particle-coupling').addEventListener('change',()=>{value.sizing=$('#particle-coupling').checked?'viktor':'fixed';change();});
  $('#particle-reset').addEventListener('click',()=>{value={count:null,sizing:'viktor'};change();});
  $('#particle-save').addEventListener('click',()=>{
    try { localStorage.setItem(PARTICLE_KEY,JSON.stringify(value));$('#particle-saved').textContent='Сохранено в этом браузере. Готовая страница обновится автоматически.'; }
    catch { $('#particle-saved').textContent='Не удалось сохранить в браузере. Настройки пока действуют в предпросмотре.'; }
  });
  render();
  return {get value(){return {...value};},update:render};
}
