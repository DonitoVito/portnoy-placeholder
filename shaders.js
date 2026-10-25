// Маска и частицы используют одно поле скоростей. Изображение видео не деформируется:
// координаты кадра постоянны, фокус меняет только радиус симметричного размытия.
window.LiquidFocusShaders = {
  dye: `#version 300 es
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uDye, uVelocity;
  uniform vec2 uGrid, uScreen, uPoint, uRadius;
  uniform float uDt, uTime, uActive;
  out vec4 o;
  void main() {
    vec2 uv = gl_FragCoord.xy / uGrid;
    vec2 velocity = texture(uVelocity, uv).xy;
    // Тот же коэффициент переноса, что у частиц в fluid-режиме.
    vec2 back = clamp(uv - velocity * uDt * 1.6, vec2(0.0), vec2(1.0));
    vec2 t = 1.0 / uGrid;
    float old = texture(uDye, back).r * .60;
    old += (texture(uDye, back + vec2(t.x, 0)).r
      + texture(uDye, back - vec2(t.x, 0)).r
      + texture(uDye, back + vec2(0, t.y)).r
      + texture(uDye, back - vec2(0, t.y)).r) * .10;
    old *= exp(-uDt * 2.15);
    vec2 d = (uv - uPoint) * uScreen / uRadius;
    float angle = atan(d.y, d.x);
    float edge = 1.0 + .11 * sin(3.0 * angle + uTime * .65)
      + .075 * cos(5.0 * angle - uTime * .39)
      + .045 * sin(7.0 * angle + uTime * .23);
    float source = exp(-dot(d, d) / (edge * edge) * 1.55) * uActive;
    // Слияние капли со следом без бесконечного накопления всего экрана.
    float tether = 1.0 - smoothstep(1.18, 1.85, length(d));
    float density = max(old, source) * tether;
    o = vec4(density, 0, 0, 1);
  }`,

  composite: `#version 300 es
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uAcc, uMask, uVideo, uSoft, uDye;
  uniform vec2 uRes, uMarkPos, uMarkSize, uCursorPx, uVideoSize, uRadius;
  uniform vec4 uVideoRect;
  uniform float uDark, uVideoOn, uDensK, uLetters, uFade;
  uniform float uBlurPx, uFeather, uMaskView, uMaskPresence, uSharpRadius, uEdgeBlur;
  uniform float uFocusGraphic, uGraphicOpacity, uGraphicSearch, uGraphicLock;
  uniform float uGraphicFade, uGraphicTime, uGraphicColor, uGraphicDpr;
  uniform float uInspectFull, uInspectOutline;
  out vec4 o;
  vec3 focusedVideo(vec2 uv, float blur) {
    vec2 stepPx = vec2(blur) / uVideoRect.zw;
    vec3 color = texture(uVideo, uv).rgb * .20;
    // Концентрические равномерные выборки: никакого зума или преломления.
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996323;
      float r = sqrt((float(i) + .5) / 12.0);
      color += texture(uVideo, clamp(uv + vec2(cos(a), sin(a)) * r * stepPx,
        vec2(0), vec2(1))).rgb * (.80 / 12.0);
    }
    return color;
  }
  float letterAt(vec2 point) {
    vec2 m = (point - uMarkPos) / uMarkSize;
    if (any(lessThan(m, vec2(0))) || any(greaterThan(m, vec2(1)))) return 0.0;
    return texture(uMask, m).a * uLetters;
  }
  vec3 showOutline(vec3 color, vec2 point) {
    if (uInspectOutline < .5) return color;
    float spread = 1.1 * uGraphicDpr;
    float hi = letterAt(point), lo = hi;
    for (int i=0; i<8; i++) {
      float angle = float(i) * .785398;
      float a = letterAt(point + vec2(cos(angle),sin(angle))*spread);
      hi = max(hi,a); lo = min(lo,a);
    }
    return mix(color, vec3(1.0,.76,.35), clamp(hi-lo,0.0,1.0));
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    if (uInspectFull > .5) {
      vec2 imageUv = (px-uVideoRect.xy)/uVideoRect.zw;
      vec3 image = vec3(0);
      if (uVideoOn > .5 && all(greaterThanEqual(imageUv,vec2(0))) && all(lessThanEqual(imageUv,vec2(1)))) image = texture(uVideo,imageUv).rgb;
      o = vec4(showOutline(image,px),1); return;
    }
    vec4 acc = texture(uAcc, uv) * uFade;
    float w = acc.a;
    vec3 pigment = acc.rgb / max(w, .0001);
    vec3 paper = uDark > .5 ? vec3(.018, .018, .025) : vec3(.985);
    vec3 ink = uDark > .5 ? vec3(.97) : vec3(.015);
    float cov = 1.0 - exp(-w * uDensK);
    vec3 col = mix(paper, pigment, min(cov, .82));
    vec2 m = (px - uMarkPos) / uMarkSize;
    float letter = 0.0;
    if (all(greaterThanEqual(m, vec2(0))) && all(lessThanEqual(m, vec2(1))))
      letter = texture(uMask, m).a * uLetters;
    float density = texture(uDye, uv).r;
    // Мелкие вихри на кромке берём из реальной плотности частиц.
    float particleEdge = clamp(texture(uSoft, uv).a, 0.0, 1.0);
    density += particleEdge * .055 * smoothstep(.04, .22, density);
    float maskShape = smoothstep(.22 - uFeather, .22 + uFeather, density);
    float coverage = maskShape * uMaskPresence;
    float distance = length((px - uCursorPx) / max(vec2(1.0), uRadius));
    // Плотный центр постепенно открывает реальный слой частиц к кромке.
    // Плотность сохраняет жидкую форму, расстояние ослабляет длинные хвосты.
    float centerToEdge = 1.0 - smoothstep(.22, 1.2, distance);
    float flowOpacity = smoothstep(.04, .90, density);
    float liquid = coverage * min(flowOpacity, centerToEdge);
    // Сквозь полупрозрачное видео видны частицы, без двойной белой надписи.
    float replaceLetters = uVideoOn > .5 && uMaskView < .5 ? coverage : 0.0;
    col = mix(col, ink, letter * (1.0 - replaceLetters));
    // Видимый контур задаёт только жидкость — без прямоугольного обрезания.
    if (uMaskView > .5) {
      o = vec4(mix(col, vec3(.16, .69, .71), liquid * .86), 1);
      return;
    }
    if (liquid > .001 && uVideoOn > .5) {
      vec2 videoUv = (px - uVideoRect.xy) / uVideoRect.zw;
      // В центре — поиск фокуса; края всегда немного мягче.
      float blur = uBlurPx + smoothstep(uSharpRadius, 1.18, distance) * uEdgeBlur;
      vec3 video = vec3(0);
      if (all(greaterThanEqual(videoUv, vec2(0))) && all(lessThanEqual(videoUv, vec2(1))))
        video = focusedVideo(videoUv, blur);
      col = mix(col, video, liquid);
      // Тонкая пигментная кромка связывает частички с поверхностью маски.
      float rim = maskShape * (1.0 - maskShape) * uMaskPresence * centerToEdge;
      col = mix(col, pigment, rim * min(cov * 1.6, .3));
      // Необязательная графика лаборатории: только добавление поверх
      // готового изображения, без изменений плотности или прозрачности маски.
      vec3 accent = mix(vec3(.97, .96, .93), vec3(.73, .85, .68), uGraphicLock * uGraphicColor);
      if (uFocusGraphic > .5 && uFocusGraphic < 1.5) {
        vec2 texel = 1.5 / uVideoSize;
        vec3 dx = texture(uVideo, clamp(videoUv + vec2(texel.x, 0), vec2(0), vec2(1))).rgb
          - texture(uVideo, clamp(videoUv - vec2(texel.x, 0), vec2(0), vec2(1))).rgb;
        vec3 dy = texture(uVideo, clamp(videoUv + vec2(0, texel.y), vec2(0), vec2(1))).rgb
          - texture(uVideo, clamp(videoUv - vec2(0, texel.y), vec2(0), vec2(1))).rgb;
        float detail = smoothstep(.07, .35, length(dx) + length(dy));
        vec2 cells = px / (2.7 * uGraphicDpr);
        vec2 seed = floor(cells);
        float grain = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
        float dots = (1.0 - smoothstep(.12, .46, length(fract(cells) - .5))) * smoothstep(.35, .75, grain);
        float sharp = 1.0 - smoothstep(.06, .40, uGraphicSearch);
        float light = detail * dots * sharp * liquid * uGraphicOpacity * uGraphicFade;
        col = mix(col, accent, min(.8, light * 2.4));
      }
      if (uFocusGraphic > 1.5) {
        // Изолиния того же поля жидкости, которое рисует маску.
        float width = max(.001, fwidth(density) * uGraphicDpr * .85);
        float contour = 1.0 - smoothstep(width, width * 2.0, abs(density - .22));
        vec2 local = (px - uCursorPx) / max(vec2(1), uRadius);
        float angle = atan(local.y, local.x);
        float fragments = smoothstep(.25, .65, sin(angle * 5.0 + uGraphicTime * .6));
        float light = contour * fragments * uMaskPresence * uGraphicOpacity * uGraphicFade;
        col = mix(col, accent, light * .85);
      }
    }
    o = vec4(showOutline(col,px), 1);
  }`
};
