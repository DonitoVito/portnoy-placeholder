export function normalizeReticle(input) {
  return {
    style: ['corners', 'points', 'threads', 'details', 'arcs', 'edge', 'none'].includes(input?.style) ? input.style : 'corners',
    opacity: typeof input?.opacity === 'number' && Number.isFinite(input.opacity)
      ? Math.max(.2, Math.min(1, input.opacity)) : .4,
    color: typeof input?.color === 'boolean' ? input.color : true
  };
}

// Размер и прозрачность маски здесь только читаются. Рамка — отдельный слой.
export class FocusReticle {
  constructor(element) {
    this.element = element;
    this.phase = '';
    this.lockedAt = null;
    this.threads = [...element.querySelectorAll('.thread')];
    this.arcA = element.querySelector('.arc-a');
    this.arcB = element.querySelector('.arc-b');
    this.configure();
  }
  configure(settings) {
    this.settings = normalizeReticle(settings);
    this.element.dataset.style = this.settings.style;
    this.element.dataset.color = String(this.settings.color);
  }
  update({ phase, blur, mask, time, reduced }) {
    if (phase !== this.phase) {
      this.lockedAt = phase === 'locked' ? time : null;
      this.phase = phase;
      this.element.dataset.phase = phase;
    }
    const enabled = ['corners', 'points', 'threads', 'arcs'].includes(this.settings.style);
    const lockAge = this.lockedAt === null ? 0 : Math.max(0, time - this.lockedAt);
    // При фиксации — короткое подтверждение и плавное затихание.
    const settled = reduced || phase !== 'locked' ? 1 : .3 + .7 * Math.exp(-lockAge * 2.8);
    const opacity = enabled ? mask.presence * this.settings.opacity * settled : 0;
    // Используем реальное размытие, поэтому две попытки модели дают два
    // прохода рамки. У декорации нет собственного независимого цикла.
    const search = reduced ? 0 : Math.min(1, blur / 5);
    const experimental = this.settings.style === 'threads' || this.settings.style === 'arcs';
    const size = experimental
      ? Math.max(82, Math.min(138, mask.radiusX * 1.1))
      : Math.max(56, Math.min(96, mask.radiusX * .84)) * (.92 + search * .22);
    if (this.settings.style === 'threads') {
      const movement = reduced ? 0 : Math.min(1, search * 1.5);
      for (let i = 0; i < this.threads.length; i++) {
        const y = 42 + i * 8;
        const bend = movement * (12 + 7 * Math.sin(time * .8 + i * 1.7));
        const spread = 10 * movement;
        this.threads[i].setAttribute('d',
          `M${27 - spread} ${y + 7} C${40 - spread} ${y - bend} ${60 + spread} ${y + bend} ${73 + spread} ${y - 7}`);
      }
    }
    if (this.settings.style === 'arcs') {
      const split = search * 13;
      this.arcA.setAttribute('transform', `translate(${-split} ${split * .32}) rotate(${-search * 18} 50 50)`);
      this.arcB.setAttribute('transform', `translate(${split} ${-split * .32}) rotate(${search * 18} 50 50)`);
    }
    this.element.style.transform = `translate(${mask.x}px, ${mask.y}px) translate(-50%, -50%) scale(${size / 100})`;
    this.element.style.opacity = opacity.toFixed(3);
    this.element.dataset.visible = String(opacity > .01);
  }
}
