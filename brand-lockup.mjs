// Original Portnoy artwork. Placement follows Viktor's logo lockup (4917 × 1326).
export function createBrandLockup() {
  const production = document.createElement('span');
  production.className = 'brand-production';
  production.setAttribute('aria-hidden', 'true');
  document.querySelector('#stage').append(production);
  if (!document.querySelector('.head')) {
    const face = document.createElement('img');
    face.className = 'head brand-face';
    face.src = 'assets/head.svg';
    face.alt = '';
    face.setAttribute('aria-hidden', 'true');
    document.body.append(face);
  }
  return {
    layout({x,y,w,h}) {
      Object.assign(production.style, {
        // The SVG is sized by its height (322 units), with 20 units before the ink.
        left: `${x - h * .8048 * 20 / 322}px`, top: `${y + h * 1.1382}px`,
        width: `${w * .4353}px`, height: `${h * .8048}px`
      });
    },
    setVisible(visible) { production.hidden = !visible; }
  };
}
