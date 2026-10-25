// Общая модель: основная версия использует SELECTED_FOCUS, лаборатория — изменяемые настройки.
export const DEFAULTS = Object.freeze({
  mode: 'hunt', strength: .8, settle: .28, delay: .15, duration: 1.6,
  passes: 3, period: 4, manual: 2, center: .24, edge: 3.5
});
// Выбор Саши по скриншотам от 20 октября; доступен независимо от localStorage.
export const SELECTED_FOCUS = Object.freeze({
  ...DEFAULTS, mode: 'hunt', strength: .7, settle: .22, delay: .1,
  duration: 1.3, passes: 2, center: .31, edge: 2.4
});
export const PRESETS = Object.freeze({
  sasha: { ...SELECTED_FOCUS },
  current: { ...DEFAULTS, mode: 'track', strength: .4, settle: 3 / 14 },
  camera: { ...DEFAULTS },
  slow: { ...DEFAULTS, strength: 1.1, settle: .55, delay: .3, duration: 2.8, passes: 2 }
});
const limits = {
  strength: [0, 1.8], settle: [.1, 1.5], delay: [0, .8], duration: [.5, 3.5],
  passes: [1, 4], period: [1.5, 8], manual: [0, 10], center: [.05, .95], edge: [0, 10]
};
export function normalizeSettings(input = {}) {
  const settings = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return settings;
  if (['track', 'hunt', 'breathe', 'manual'].includes(input.mode)) settings.mode = input.mode;
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) {
      settings[key] = Math.max(min, Math.min(max, input[key]));
    }
  }
  settings.passes = Math.round(settings.passes);
  return settings;
}
export class LabFocusModel {
  constructor(settings) {
    this.configure(settings);
    this.blur = 0;
    this.still = 10;
    this.time = 0;
    this.phase = 'locked';
    this.replayLeft = 0;
    this.bypass = false;
  }
  configure(settings) { this.settings = normalizeSettings(settings); }
  replay() { this.time = 0; this.still = 0; this.replayLeft = .35; }
  update(dt, speed, reduced = false) {
    dt = Math.max(0, Math.min(dt, .08));
    const s = this.settings;
    this.time += dt;
    const moving = speed > 32 || this.replayLeft > 0;
    this.replayLeft = Math.max(0, this.replayLeft - dt);
    this.still = moving ? 0 : this.still + dt;
    if (reduced || this.bypass) {
      this.blur = 0;
      this.phase = 'locked';
      return 0;
    }
    let target = 0;
    if (s.mode === 'manual') {
      target = s.manual;
      this.phase = 'manual';
    } else if (s.mode === 'breathe') {
      target = (1 - Math.cos(this.time / s.period * Math.PI * 2)) * 1.7 * s.strength;
      this.phase = 'breathing';
    } else if (moving) {
      target = Math.min(6.5, 2 + Math.max(speed, this.replayLeft > 0 ? 600 : 0) / 230) * s.strength;
      this.phase = 'moving';
    } else if (s.mode === 'hunt' && this.still < s.delay + s.duration) {
      const t = Math.max(0, (this.still - s.delay) / s.duration);
      const envelope = Math.pow(1 - t, 1.25);
      target = 5.3 * s.strength * envelope * (.1 + .9 * (1 + Math.cos(t * Math.PI * 2 * s.passes)) / 2);
      this.phase = this.still < s.delay ? 'waiting' : 'hunting';
    } else {
      this.phase = this.blur < .12 ? 'locked' : 'hunting';
    }
    this.blur += (target - this.blur) * (1 - Math.exp(-dt * 3 / s.settle));
    if (target === 0 && this.blur < .025) this.blur = 0;
    return this.blur;
  }
}
