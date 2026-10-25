/* Основа: частицы Виктора, e4ca92c, alt/particles-engine.js.
   Версия Саши: общий перенос частиц/маски, видео без деформации, поиск фокуса. */
window.PortnoyParticles = (() => {
function create(canvas, opts) {
  opts = opts || {};
  const onStat = opts.onStat || (() => {}), onLevel = opts.onLevel || (() => {});
  const stat = { set textContent(v) { onStat(v); } };
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, depth: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) { stat.textContent = 'WebGL2 недоступен, надпись без частиц'; return null; }
  const floatRT = gl.getExtension('EXT_color_buffer_float');
  const halfRT = floatRT ? null : gl.getExtension('EXT_color_buffer_half_float');
  if (!floatRT && !halfRT) { stat.textContent = 'Нет float-текстур, надпись без частиц'; return null; }
  const INTERNAL = gl.RGBA16F, TYPE = gl.FLOAT;
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const rendererShort = (() => { const r = String(renderer); const m = r.match(/Renderer:\s*([^,)]+)/) || r.match(/^ANGLE \(([^,]+),\s*([^,)]+)/); return (m ? (m[2] && !/ANGLE/.test(m[2]) ? m[2] : m[1]) : r).trim().slice(0, 40); })();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = opts.mobile != null ? !!opts.mobile : (innerWidth <= 720 || /Mobi|Android/i.test(navigator.userAgent));
  const defaultParticleCount = mobile ? 65536 : 262144;

  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}`;

  const VS_QUAD = `#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

  const FS_SIM = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uPos, uVel, uField, uMaskSoft;
  uniform int uParticleCount, uParticleWidth;
  uniform float uTime, uDt, uSpawnNear, uCursorOn, uMode, uAspect, uTanF, uCamZ, uTarget;
  uniform vec3 uCursor, uBox, uCam; uniform vec2 uRes, uMarkPos, uMarkSize, uFieldScale, uFieldTexel, uSoftStep;
  layout(location=0) out vec4 oPos; layout(location=1) out vec4 oVel;
  ${NOISE}
  vec3 curl(vec3 p){float e=0.07;
    float a=snoise(p+vec3(0.0,e,0.0)),b=snoise(p-vec3(0.0,e,0.0)),c=snoise(p+vec3(e,0.0,0.0)),d=snoise(p-vec3(e,0.0,0.0));
    float z=snoise(p*0.6+vec3(17.3,9.1,0.0));
    return vec3((a-b)/(2.0*e),-(c-d)/(2.0*e),z*0.35);}
  vec2 toUv(vec3 p){return vec2((p.x-uCam.x)/(uTanF*uAspect*uCamZ),(p.y-uCam.y)/(uTanF*uCamZ))*0.5+0.5;}
  void main(){
    ivec2 ij=ivec2(gl_FragCoord.xy); vec4 s=texelFetch(uPos,ij,0); vec3 vel=texelFetch(uVel,ij,0).xyz;
    if(ij.y*uParticleWidth+ij.x>=uParticleCount){oPos=s;oVel=vec4(vel,0.0);return;}
    vec2 seed=vec2(ij)+vec2(0.37,0.91);
    float h1=hash12(seed),h2=hash12(seed+3.1),h3=hash12(seed+7.7),h4=hash12(seed+11.3+floor(uTime*0.1));
    float life=2.2+4.5*h1;
    vec3 p=s.xyz; float age=s.w+uDt/life;
    vec3 d=uCursor-p; float r2=dot(d,d); float r=sqrt(r2); vec3 dir=d/max(r,1e-4);
    int mode=int(uMode+0.5);
    vec3 v=vec3(0.0); bool respawn=false;
    if(mode==0){
      float nearC=exp(-r2*1.6);
      v=curl(p*0.9+vec3(0.0,0.0,uTime*0.07))*0.3+curl(p*3.1+vec3(7.0,3.0,uTime*0.15))*0.22*nearC;
      float g=uCursorOn*min(0.42/(r2+0.22),1.3);
      v+=dir*(g*0.34-uCursorOn*0.07/(r2*9.0+0.03))+cross(dir,vec3(0.0,0.0,1.0))*g*1.25*(0.55+0.45*h2);
      v+=vec3(0.0,0.0,(h4-0.5)*0.12);
      float sp=length(v); if(sp>1.4)v*=1.4/sp;
    } else if(mode==1){
      // Галактика: наклонённый диск, орбитальная скорость падает от центра, диск плоский, ядро плотное.
      vec3 n=normalize(vec3(0.28*sin(uTime*0.07),0.72,0.62));
      vec3 q=-d; float h=dot(q,n); vec3 qp=q-n*h; float rr=length(qp)+1e-3; vec3 er=qp/rr; vec3 et=cross(n,er);
      float vOrb=0.78/sqrt(rr+0.09);
      v=et*vOrb*(0.8+0.2*h2)-n*h*2.6-er*0.06+curl(p*2.2+vec3(0.0,0.0,uTime*0.1))*0.05;
      float sp=length(v); if(sp>1.8)v*=1.8/sp;
      if(rr>1.6)respawn=true;
    } else if(mode==2){
      // Жидкость: частицы плывут по полю скоростей, которое размешивает курсор.
      vec2 uv=toUv(p); vec2 f=texture(uField,uv).xy;
      v=vec3(f*uFieldScale,0.0)+curl(p*1.2+vec3(0.0,0.0,uTime*0.1))*0.07;
      v.z+=(h4-0.5)*0.08-p.z*0.3;
      v+=dir*uCursorOn*min(0.1/(r2+0.3),0.3);
    } else if(mode==3){
      // Стая: выравнивание по соседям, сближение при редкости, разлёт при тесноте, слабая тяга к курсору.
      vec2 uv=toUv(p); vec4 g=texture(uField,uv); float cnt=max(g.z,1.0); vec2 avg=g.xy/cnt;
      vec2 e=uFieldTexel*2.0;
      float dl=texture(uField,uv-vec2(e.x,0.0)).z,dr=texture(uField,uv+vec2(e.x,0.0)).z,dd=texture(uField,uv-vec2(0.0,e.y)).z,du=texture(uField,uv+vec2(0.0,e.y)).z;
      vec2 grad=vec2(dr-dl,du-dd); vec2 gn=grad/max(length(grad),1e-4);
      vec2 a=(avg-vel.xy)*2.4;
      a+=(g.z<uTarget?0.55:-1.1)*gn;
      a+=dir.xy*uCursorOn*0.4;
      a+=curl(p*1.4+vec3(0.0,0.0,uTime*0.12)).xy*0.6;
      vel.xy+=a*uDt; vel.z=(vel.z+(h4-0.5)*0.06-p.z*0.2)*0.98;
      float sp=length(vel.xy); vel.xy*=clamp(sp,0.35,1.3)/max(sp,1e-4);
      v=vel;
    } else {
      // Надпись: частицы обтекают буквы снаружи, как вода камни; внутри букв пусто, слово читается пустотой.
      vec2 uv=toUv(p); vec2 px=vec2(uv.x*uRes.x,(1.0-uv.y)*uRes.y); vec2 m=(px-uMarkPos)/uMarkSize;
      float mv=0.0; vec2 gm=vec2(0.0);
      if(m.x>-0.05&&m.x<1.05&&m.y>-0.25&&m.y<1.25){
        vec2 e=uSoftStep;
        mv=texture(uMaskSoft,m).a;
        gm=vec2(texture(uMaskSoft,m+vec2(e.x,0.0)).a-texture(uMaskSoft,m-vec2(e.x,0.0)).a,-(texture(uMaskSoft,m+vec2(0.0,e.y)).a-texture(uMaskSoft,m-vec2(0.0,e.y)).a));
      }
      vec2 gn=gm/max(length(gm),1e-4);
      float inside=smoothstep(0.12,0.5,mv);
      // Выталкивание из буквы и скольжение вдоль её края; направление скольжения у каждой частицы своё.
      vec2 slide=vec2(-gn.y,gn.x)*(h2<0.5?1.0:-1.0);
      v=vec3(-gn*inside*2.6+slide*smoothstep(0.03,0.3,mv)*0.55,0.0);
      v+=curl(p*1.1+vec3(0.0,0.0,uTime*0.08))*0.16;
      float g=uCursorOn*min(0.42/(r2+0.22),1.3)*0.6;
      v+=dir*g*0.3+cross(dir,vec3(0.0,0.0,1.0))*g*1.0;
      v.z+=(h4-0.5)*0.06-p.z*0.5;
      float sp=length(v); if(sp>1.5)v*=1.5/sp;
    }
    p+=v*uDt; if(mode!=3)vel=v;
    vec3 home=vec3(uCam.xy,0.0);
    bool out_=any(greaterThan(abs(p-home),uBox));
    if(age>1.0||out_||respawn){
      vec3 rnd=vec3(hash12(seed+uTime),hash12(seed+uTime*1.7+2.0),hash12(seed+uTime*0.3+5.0))*2.0-1.0;
      if(mode==1){
        vec3 n=normalize(vec3(0.28*sin(uTime*0.07),0.72,0.62)); vec3 ax=normalize(cross(n,vec3(1.0,0.0,0.0))); vec3 ay=cross(n,ax);
        float ang=rnd.x*3.14159, rad=1.05*sqrt(rnd.y*0.5+0.5);
        rad*=1.0+0.14*sin(2.0*ang-2.6*log(rad+0.15)+uTime*0.05);
        float near=step(h3,0.9*uCursorOn+0.05);
        vec3 onDisk=uCursor+(ax*cos(ang)+ay*sin(ang))*rad+n*rnd.z*0.05*(0.3+rad);
        p=mix(home+rnd*uBox,onDisk,near);
      } else if(mode==4){
        // Половина рождается в полосе надписи, треть у курсора, остальные где угодно.
        vec2 c0=vec2(uMarkPos.x/uRes.x*2.0-1.0,1.0-uMarkPos.y/uRes.y*2.0), c1=vec2((uMarkPos.x+uMarkSize.x)/uRes.x*2.0-1.0,1.0-(uMarkPos.y+uMarkSize.y)/uRes.y*2.0);
        vec2 ndc=mix(c0,c1,vec2(rnd.x*0.5+0.5,rnd.y*0.5+0.5))+vec2(0.0,rnd.z*0.16);
        vec3 onWord=vec3(ndc.x*uTanF*uAspect*uCamZ+uCam.x,ndc.y*uTanF*uCamZ+uCam.y,rnd.z*0.2);
        vec3 ring=rnd*vec3(0.85,0.6,0.5)*(0.25+0.75*h2);
        p=h3<0.62?onWord:(h3<0.85+0.1*uCursorOn?uCursor+ring:home+rnd*uBox);
      } else {
        float share=mode==2?0.35:mode==3?0.6:uSpawnNear;
        float near=step(h3,share*uCursorOn+0.05);
        vec3 ring=rnd*vec3(0.85,0.6,0.5)*(0.25+0.75*h2);
        p=mix(home+rnd*uBox,uCursor+ring,near);
      }
      age=0.0; vel=vec3(0.0);
      if(mode==3){vel=vec3(cos(rnd.x*3.14159),sin(rnd.x*3.14159),0.0)*0.6;}
    }
    oPos=vec4(p,age); oVel=vec4(vel,0.0);
  }`;

  // Жидкость: сетка скоростей. Перенос, размешивание курсором, давление, вычитание градиента.
  const FS_ADVECT = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uVelG; uniform vec2 uGrid; uniform float uDt, uDissip; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy/uGrid; vec2 v=texture(uVelG,uv).xy; vec2 back=uv-v*uDt; o=vec4(texture(uVelG,back).xy*uDissip,0.0,1.0); }`;
  const FS_SPLATF = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uVelG; uniform vec2 uGrid, uPoint, uForce; uniform float uRadius, uAspectG; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy/uGrid; vec2 dv=(uv-uPoint)*vec2(uAspectG,1.0); float a=exp(-dot(dv,dv)/(uRadius*uRadius));
    o=vec4(texture(uVelG,uv).xy+uForce*a,0.0,1.0); }`;
  const FS_DIV = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uVelG; uniform vec2 uGrid; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy/uGrid; vec2 t=1.0/uGrid;
    float l=texture(uVelG,uv-vec2(t.x,0.0)).x,r=texture(uVelG,uv+vec2(t.x,0.0)).x,b=texture(uVelG,uv-vec2(0.0,t.y)).y,u=texture(uVelG,uv+vec2(0.0,t.y)).y;
    o=vec4(0.5*((r-l)+(u-b)),0.0,0.0,1.0); }`;
  const FS_JACOBI = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uPre, uDiv; uniform vec2 uGrid; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy/uGrid; vec2 t=1.0/uGrid;
    float l=texture(uPre,uv-vec2(t.x,0.0)).x,r=texture(uPre,uv+vec2(t.x,0.0)).x,b=texture(uPre,uv-vec2(0.0,t.y)).x,u=texture(uPre,uv+vec2(0.0,t.y)).x;
    o=vec4((l+r+b+u-texture(uDiv,uv).x)*0.25,0.0,0.0,1.0); }`;
  const FS_GRAD = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uPre, uVelG; uniform vec2 uGrid; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy/uGrid; vec2 t=1.0/uGrid;
    float l=texture(uPre,uv-vec2(t.x,0.0)).x,r=texture(uPre,uv+vec2(t.x,0.0)).x,b=texture(uPre,uv-vec2(0.0,t.y)).x,u=texture(uPre,uv+vec2(0.0,t.y)).x;
    o=vec4(texture(uVelG,uv).xy-0.5*vec2(r-l,u-b),0.0,1.0); }`;
  // Стая: сумма скоростей и число частиц по клеткам.
  const VS_SPLATP = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uPos, uVel; uniform int uW; uniform vec3 uCam; uniform float uAspect, uTanF, uCamZ; out vec2 vV;
  void main(){ ivec2 ij=ivec2(gl_VertexID % uW, gl_VertexID / uW); vec3 p=texelFetch(uPos,ij,0).xyz; vV=texelFetch(uVel,ij,0).xy;
    vec2 ndc=vec2((p.x-uCam.x)/(uTanF*uAspect*uCamZ),(p.y-uCam.y)/(uTanF*uCamZ)); gl_Position=vec4(ndc,0.0,1.0); gl_PointSize=3.0; }`;
  const FS_SPLATP = `#version 300 es
  precision highp float; in vec2 vV; out vec4 o; void main(){ o=vec4(vV,1.0,0.0); }`;

  const VS_PTS = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uPos; uniform int uW; uniform mat4 uProj; uniform vec3 uCam, uCursor; uniform float uSize, uFocus, uDpr, uTime;
  out float vA; out vec3 vC; out float vCoc;
  vec3 ramp(float t){
    vec3 c1=vec3(1.0,0.514,0.341),c2=vec3(1.0,0.322,0.380),c3=vec3(1.0,0.804,0.847),c4=vec3(0.957,0.906,0.871);
    return t<0.33?mix(c1,c2,t/0.33):t<0.66?mix(c2,c3,(t-0.33)/0.33):mix(c3,c4,(t-0.66)/0.34);
  }
  void main(){
    ivec2 ij=ivec2(gl_VertexID % uW, gl_VertexID / uW); vec4 s=texelFetch(uPos,ij,0);
    vec3 p=s.xyz-uCam; vec4 clip=uProj*vec4(p,1.0); gl_Position=clip;
    float depth=-p.z; float coc=clamp(abs(s.z-uFocus)*1.4,0.0,1.0); vCoc=coc;
    gl_PointSize=clamp(uSize*uDpr/depth*(1.0+coc*2.2),1.5,40.0);
    float fade=sin(clamp(s.w,0.0,1.0)*3.14159);
    vA=fade/(1.0+coc*5.0);
    vec2 rel=s.xy-uCursor.xy; float r=length(rel); float ang=atan(rel.y,rel.x);
    float u=fract(float(gl_VertexID)*0.4142135624);
    float t=clamp(r*0.55+sin(ang+uTime*0.15)*0.08+(u-0.5)*0.1,0.0,1.0);
    vC=ramp(t);
  }`;

  // Частицы копятся в текстуру: цвет с весом и сам вес. Вес и есть плотность облака.
  const FS_PTS = `#version 300 es
  precision highp float;
  in float vA; in vec3 vC; in float vCoc; uniform float uAlpha; out vec4 o;
  void main(){
    vec2 q=gl_PointCoord-0.5; float d=length(q);
    float cov=mix(smoothstep(0.5,0.12,d),smoothstep(0.5,0.38,d),vCoc);
    float a=cov*vA*uAlpha; if(a<0.0015)discard;
    o=vec4(vC*a,a);
  }`;

  const FS_COMP = LiquidFocusShaders.composite;
  const FS_DYE = LiquidFocusShaders.dye;

  const FS_BLIT = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
  void main(){ vec2 uv=gl_FragCoord.xy*8.0*uTexel; vec2 d=uTexel*3.0;
    o=(texture(uSrc,uv+vec2(d.x,d.y))+texture(uSrc,uv+vec2(-d.x,d.y))+texture(uSrc,uv+vec2(d.x,-d.y))+texture(uSrc,uv+vec2(-d.x,-d.y))+texture(uSrc,uv)*2.0)/6.0; }`;

  function program(vs, fs) {
    const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  let simP, ptsP, compP, blitP, dyeP, advP, splfP, divP, jacP, gradP, splpP;
  try { simP = program(VS_QUAD, FS_SIM); ptsP = program(VS_PTS, FS_PTS); compP = program(VS_QUAD, FS_COMP); blitP = program(VS_QUAD, FS_BLIT); dyeP = program(VS_QUAD, FS_DYE); advP = program(VS_QUAD, FS_ADVECT); splfP = program(VS_QUAD, FS_SPLATF); divP = program(VS_QUAD, FS_DIV); jacP = program(VS_QUAD, FS_JACOBI); gradP = program(VS_QUAD, FS_GRAD); splpP = program(VS_SPLATP, FS_SPLATP); } catch (e) { stat.textContent = 'Шейдер не собрался, надпись без частиц'; console.error(e); return null; }
  const U = (p, n) => gl.getUniformLocation(p, n);
  gl.bindVertexArray(gl.createVertexArray());

  let MW = 3454, MH = 605;
  const BOX = [1.95, 1.25, 0.95];
  const LEVELS = [{ label: '2 млн', w: 2048, h: 1024 }, { label: '1 млн', w: 1024, h: 1024 }, { label: '260 тыс', w: 512, h: 512 }, { label: '65 тыс', w: 256, h: 256 }];
  let level = 1, W = 1024, H = 1024, tex = [], velTex = [], fbo = [], cur = 0, N = 0, auto = opts.autoParticles !== false, mode = 0, flockTarget = 100;
  let particleSizing = 'viktor';
  const particleStats = () => ({ count: N, max: defaultParticleCount, mobile,
    sizing: particleSizing, sizeRatio: particleSizing === 'viktor' ? Math.pow(defaultParticleCount / (N || defaultParticleCount), .25) : 1 });
  const FLOCK_W = 160, FLOCK_H = 90;
  function seedTexture() {
    const data = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { data[i * 4] = (Math.random() * 2 - 1) * BOX[0]; data[i * 4 + 1] = (Math.random() * 2 - 1) * BOX[1]; data[i * 4 + 2] = (Math.random() * 2 - 1) * BOX[2]; data[i * 4 + 3] = Math.random(); }
    return data;
  }
  function build(idx) {
    level = idx; W = LEVELS[idx].w; H = LEVELS[idx].h; N = W * H;
    onLevel(idx, LEVELS[idx].label);
    if (accTex) makeAcc();
    tex.forEach(t => gl.deleteTexture(t)); velTex.forEach(t => gl.deleteTexture(t)); fbo.forEach(f => gl.deleteFramebuffer(f)); tex = []; velTex = []; fbo = [];
    const data = seedTexture();
    for (let i = 0; i < 2; i++) {
      const mk = (fill) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, INTERNAL, W, H, 0, gl.RGBA, TYPE, fill); return t; };
      const t = mk(data), tv = mk(null);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tv, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      tex.push(t); velTex.push(tv); fbo.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    flockTarget = 9 * N / (FLOCK_W * FLOCK_H) * 1.4;
    opts.onParticles?.(particleStats());
  }

  // Накопитель, маска надписи, ролик.
  let accTex = null, accFbo = gl.createFramebuffer(), maskTex = gl.createTexture(), videoTex = gl.createTexture();
  let softTex = null, softFbo = gl.createFramebuffer(), softW = 1, softH = 1, accW = 1, accH = 1;
  // Сетки: жидкость (скорость, давление, дивергенция) и стая (сумма скоростей и счёт).
  const GRID_W = 256, GRID_H = 144;
  const mkGridTex = (w, h, linear) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f, w, h }; };
  const fluidVel = [mkGridTex(GRID_W, GRID_H, true), mkGridTex(GRID_W, GRID_H, true)], fluidPre = [mkGridTex(GRID_W, GRID_H, false), mkGridTex(GRID_W, GRID_H, false)], fluidDiv = mkGridTex(GRID_W, GRID_H, false);
  let fv = 0, fp = 0;
  const flock = mkGridTex(FLOCK_W, FLOCK_H, true);
  const maskSoftTex = gl.createTexture(), maskSoftCanvas = document.createElement('canvas');
  // Только проба стилов: ширина знаков и интервалы регулируются раздельно.
  const glyphColumns = [[0,249],[517,274],[1078,260],[1569,256],[2089,279],[2655,274],[3169,285]];
  const glyphGapTotal = 1577;
  let markScale = 1, glyphWidth = 1, glyphSpacing = 1;
  function drawMark(context, width, height) {
    if (glyphWidth === 1 && glyphSpacing === 1) { context.drawImage(maskImg, 0, 0, width, height); return; }
    const leftPad = glyphColumns[0][1] * (glyphWidth - 1) / 2;
    const rightPad = glyphColumns[6][1] * (glyphWidth - 1) / 2;
    const factor = width / (MW + leftPad + rightPad + glyphGapTotal * (glyphSpacing - 1));
    let precedingInk = 0;
    for (const [left, span] of glyphColumns) {
      const gapBefore = left - precedingInk;
      const x = (left + leftPad + gapBefore * (glyphSpacing - 1)) * factor, w = span * factor;
      context.drawImage(maskImg, left, 0, span, MH, x - w * (glyphWidth - 1) / 2, 0, w * glyphWidth, height);
      precedingInk += span;
    }
  }
  function rasterMaskSoft() {
    if (!maskReady) return;
    const mw = 256, mh = Math.max(1, Math.round(256 * mark.h / mark.w));
    maskSoftCanvas.width = mw; maskSoftCanvas.height = mh;
    const c = maskSoftCanvas.getContext('2d'); c.clearRect(0, 0, mw, mh); c.filter = 'blur(3px)'; drawMark(c, mw, mh); c.filter = 'none';
    gl.bindTexture(gl.TEXTURE_2D, maskSoftTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskSoftCanvas);
  }
  const prevCursor = { x: .5, y: .5 };
  const dye = [mkGridTex(512, 512, true), mkGridTex(512, 512, true)];
  let dyeIndex = 0, radiusScale = 1, feather = .0445, maskView = false;
  const focus = opts.focus;
  // Только лаборатория фокуса использует эти опции. Значения по умолчанию
  // сохраняют утверждённую сцену и прежнее размытие периферии.
  let previewAnchor = null, videoPaused = false, sharpRadius = .24, edgeBlur = 3.5;
  let focusGraphic = 0, graphicOpacity = .4, graphicColor = true, graphicLockTime = null;
  // Прежняя компактная ширина. На широком экране запас по высоте
  // сохраняет видеобуквы целиком, не раздувая маску во все стороны.
  const radiusPx = () => Math.min(innerWidth * .22, innerHeight * .22, 170) * radiusScale;
  const radiusYPx = () => Math.max(radiusPx(), innerWidth * .22 * radiusScale);
  function fluidStep(dt, cx, cy) {
    const pass = (prog, target, bind) => { gl.useProgram(prog); gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h); bind(); gl.uniform2f(U(prog, 'uGrid'), target.w, target.h); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    const texu = (prog, name, t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(U(prog, name), unit); };
    gl.disable(gl.BLEND);
    pass(advP, fluidVel[1 - fv], () => { texu(advP, 'uVelG', fluidVel[fv].t, 0); gl.uniform1f(U(advP, 'uDt'), dt); gl.uniform1f(U(advP, 'uDissip'), .992); }); fv = 1 - fv;
    const ux = (cx + 1) / 2, uy = (cy + 1) / 2, vx = (ux - prevCursor.x) / Math.max(dt, 1e-3), vy = (uy - prevCursor.y) / Math.max(dt, 1e-3);
    prevCursor.x = ux; prevCursor.y = uy;
    const sp = Math.hypot(vx, vy), lim = 2.5, k = sp > lim ? lim / sp : 1;
    pass(splfP, fluidVel[1 - fv], () => { texu(splfP, 'uVelG', fluidVel[fv].t, 0); gl.uniform2f(U(splfP, 'uPoint'), ux, uy); gl.uniform2f(U(splfP, 'uForce'), vx * k * .9 - vy * k * .35, vy * k * .9 + vx * k * .35); gl.uniform1f(U(splfP, 'uRadius'), .09); gl.uniform1f(U(splfP, 'uAspectG'), canvas.width / canvas.height); }); fv = 1 - fv;
    pass(divP, fluidDiv, () => texu(divP, 'uVelG', fluidVel[fv].t, 0));
    for (let i = 0; i < 18; i++) { pass(jacP, fluidPre[1 - fp], () => { texu(jacP, 'uPre', fluidPre[fp].t, 0); texu(jacP, 'uDiv', fluidDiv.t, 1); }); fp = 1 - fp; }
    pass(gradP, fluidVel[1 - fv], () => { texu(gradP, 'uPre', fluidPre[fp].t, 0); texu(gradP, 'uVelG', fluidVel[fv].t, 1); }); fv = 1 - fv;
  }
  function dyeStep(dt) {
    gl.disable(gl.BLEND);
    const target = dye[1 - dyeIndex];
    gl.useProgram(dyeP); gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dye[dyeIndex].t); gl.uniform1i(U(dyeP, 'uDye'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fluidVel[fv].t); gl.uniform1i(U(dyeP, 'uVelocity'), 1);
    gl.uniform2f(U(dyeP, 'uGrid'), target.w, target.h); gl.uniform2f(U(dyeP, 'uScreen'), innerWidth, innerHeight);
    gl.uniform2f(U(dyeP, 'uPoint'), maskCursor.x / innerWidth, 1 - maskCursor.y / innerHeight);
    gl.uniform1f(U(dyeP, 'uDt'), dt); gl.uniform1f(U(dyeP, 'uTime'), time);
    gl.uniform2f(U(dyeP, 'uRadius'), radiusPx(), radiusYPx()); gl.uniform1f(U(dyeP, 'uActive'), maskPresence);
    gl.drawArrays(gl.TRIANGLES, 0, 3); dyeIndex = 1 - dyeIndex;
  }
  function flockSplat(camX, camY) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, flock.f); gl.viewport(0, 0, flock.w, flock.h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(splpP);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(U(splpP, 'uPos'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, velTex[cur]); gl.uniform1i(U(splpP, 'uVel'), 1);
    gl.uniform1i(U(splpP, 'uW'), W); gl.uniform3f(U(splpP, 'uCam'), camX, camY, CAMZ); gl.uniform1f(U(splpP, 'uAspect'), aspect); gl.uniform1f(U(splpP, 'uTanF'), tanF); gl.uniform1f(U(splpP, 'uCamZ'), CAMZ);
    gl.drawArrays(gl.POINTS, 0, Math.min(N, 524288));
    gl.disable(gl.BLEND);
  }
  function setMode(i) {
    mode = i;
    if (i === 2) { [fluidVel[0], fluidVel[1], fluidPre[0], fluidPre[1], fluidDiv].forEach(g => { gl.bindFramebuffer(gl.FRAMEBUFFER, g.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  }
  const accScale = () => level === 0 ? 0.5 : 1;
  let dpr = 1, aspect = 1, proj = new Float32Array(16), mark = { x: 0, y: 0, w: 0, h: 0 };
  const maskImg = new Image(); let maskReady = false; maskImg.onload = () => { MW = maskImg.naturalWidth; MH = maskImg.naturalHeight; maskReady = true; layoutMark(); rasterMask(); rasterMaskSoft(); }; maskImg.src = opts.maskUrl || 'assets/wordmark-top.png';
  const maskCanvas = document.createElement('canvas');
  function rasterMask() {
    if (!maskReady) return;
    const mw = Math.round(mark.w * dpr), mh = Math.round(mark.h * dpr);
    maskCanvas.width = mw; maskCanvas.height = mh;
    const c = maskCanvas.getContext('2d'); c.clearRect(0, 0, mw, mh); drawMark(c, mw, mh);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
  }
  function wordResponseArea() {
    // Область управляет откликом на курсор, но не обрезает пиксели видео.
    const coreWidth = Math.max(mark.w, innerWidth * .96);
    const coreHeight = Math.max(mark.h, innerWidth * .27);
    return {
      x: (innerWidth - coreWidth) / 2,
      y: mark.y + mark.h / 2 - coreHeight / 2,
      w: coreWidth,
      h: coreHeight
    };
  }
  function wordProximity(x, y) {
    const area = wordResponseArea();
    const dx = Math.max(area.x - x, 0, x - area.x - area.w);
    const dy = Math.max(area.y - y, 0, y - area.y - area.h);
    const t = Math.max(0, 1 - Math.hypot(dx, dy) / (radiusPx() * .9));
    return t * t * (3 - 2 * t);
  }
  const video = document.createElement('video');
  video.id = 'focus-film'; video.hidden = true; document.body.append(video);
  let paused = false, contextLost = false, frameId = 0;
  video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  const videoUrl = opts.video === false ? null : (opts.video || 'assets/film-a.mp4');
  if (videoUrl) video.src = videoUrl;
  let videoOn = false, lastVideoT = -1, videoWanted = opts.videoOn !== false, lettersWanted = opts.lettersOn !== false;
  let stillImage = null, stillReady = false, stillRequest = 0, inspectFull = false, inspectOutline = false;
  video.addEventListener('loadeddata', () => {
    videoOn = true; lastVideoT = -1;
    opts.onMedia?.('ready');
    if (!reduced && !paused && !videoPaused && !document.hidden) video.play().catch(() => opts.onMedia?.('blocked'));
  });
  video.addEventListener('error', () => { videoOn = false; opts.onMedia?.('error'); });
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 2, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(12));

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    aspect = canvas.width / canvas.height;
    const f = 1 / Math.tan(38 * Math.PI / 360), n = .1, fa = 12;
    proj.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]);
    layoutMark();
    makeAcc();
    rasterMask(); rasterMaskSoft();
  }
  let markRect = null;
  function layoutMark() {
    if (markRect) { Object.assign(mark, markRect); opts.onMarkLayout?.({...mark}); return; }
    const baseW = Math.min(innerWidth * .84, 1320) * markScale;
    const leftPad = glyphColumns[0][1] * (glyphWidth - 1) / 2 / MW * baseW;
    const rightPad = glyphColumns[6][1] * (glyphWidth - 1) / 2 / MW * baseW;
    const spacingDelta = glyphGapTotal * (glyphSpacing - 1) / MW * baseW;
    mark.w = baseW + leftPad + rightPad + spacingDelta; mark.h = baseW * MH / MW;
    mark.x = (innerWidth - baseW - spacingDelta) / 2 - leftPad; mark.y = innerHeight * .46 - mark.h / 2;
    opts.onMarkLayout?.({...mark});
  }
  function makeAcc() {
    accW = Math.max(1, Math.round(canvas.width * accScale())); accH = Math.max(1, Math.round(canvas.height * accScale()));
    if (accTex) gl.deleteTexture(accTex);
    accTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, accTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, accW, accH, 0, gl.RGBA, gl.HALF_FLOAT, null);
    // Сглаженная плотность: копия в восемь раз меньше.
    if (softTex) gl.deleteTexture(softTex);
    softW = Math.max(1, Math.round(accW / 8)); softH = Math.max(1, Math.round(accH / 8));
    softTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, softTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, softW, softH, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, softFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, softTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  addEventListener('resize', resize); resize();

  const pointer = { x: 0, y: 0, clientX: 0, clientY: 0, on: 0, canReveal: false };
  const cursor = { x: 0, y: 0, on: .8 };
  const maskCursor = { x: innerWidth / 2, y: innerHeight * .46 };
  const CAMZ = 3.4, tanF = Math.tan(38 * Math.PI / 360);
  let demo = true, speed = 0, overLetter = false, maskPresence = 0;
  const updatePointer = e => {
    pointer.clientX = e.clientX; pointer.clientY = e.clientY;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = 1 - (e.clientY / innerHeight) * 2;
    pointer.canReveal = !e.target.closest('button, aside, header, footer');
    pointer.on = 1; demo = false;
    if (!paused && !videoPaused && !reduced && video.paused) video.play().catch(() => {});
  };
  addEventListener('pointermove', updatePointer);
  canvas.parentElement.addEventListener('pointerdown', updatePointer);
  document.addEventListener('mouseleave', () => { pointer.on = 0; });
  addEventListener('pointerup', e => { if (e.pointerType === 'touch') pointer.on = 0; });
  addEventListener('pointercancel', () => { pointer.on = 0; });

  let dark = !!opts.dark, overlay = false, seamPx = null, shiftX = 0;

  let time = 0, slowSince = 0, visible = false, particleFade = 0, fadeStart = 0;

  function step(dt, draw) {
    time += reduced ? 0 : dt;
    const oldX = cursor.x, oldY = cursor.y;
    const tx = demo ? Math.sin(time * .35) * .27 : pointer.x;
    const ty = demo ? Math.cos(time * .32) * .09 : pointer.y;
    const follow = 1 - Math.exp(-dt * 10);
    cursor.x += (tx - cursor.x) * follow; cursor.y += (ty - cursor.y) * follow;
    cursor.on += ((pointer.on || demo ? 1 : 0) - cursor.on) * (1 - Math.exp(-dt * 3));
    // Частицы следуют за указателем везде. Жидкая маска держится у надписи,
    // а расстояние до неё меняет только общую видимость, не форму кромки.
    const px = previewAnchor ? previewAnchor.x * innerWidth : (cursor.x + 1) / 2 * innerWidth;
    const py = previewAnchor ? previewAnchor.y * innerHeight : (1 - cursor.y) / 2 * innerHeight;
    const centerY = mark.y + mark.h / 2, travelY = mark.h * .15;
    const maskX = Math.max(mark.x, Math.min(mark.x + mark.w, px));
    const maskY = Math.max(centerY - travelY, Math.min(centerY + travelY, py));
    maskCursor.x += (maskX - maskCursor.x) * follow;
    maskCursor.y += (maskY - maskCursor.y) * follow;
    const maskTarget = previewAnchor && maskReady && lettersWanted ? 1
      : pointer.on && pointer.canReveal && maskReady && lettersWanted
        ? wordProximity(pointer.clientX, pointer.clientY) : 0;
    overLetter = maskTarget > .01;
    // При уходе с экрана или на интерфейс остаётся мягкое затухание.
    const maskRate = maskTarget > maskPresence ? 12 : 6;
    maskPresence += (maskTarget - maskPresence) * (1 - Math.exp(-dt * maskRate));
    if (!maskTarget && maskPresence < .0001) maskPresence = 0;
    speed = Math.hypot((cursor.x - oldX) * innerWidth / 2, (cursor.y - oldY) * innerHeight / 2) / Math.max(dt, .001);
    const blur = focus ? focus.update(dt, previewAnchor ? 0 : speed, reduced) : 0;
    graphicLockTime = focus?.phase === 'locked' ? (graphicLockTime ?? time) : null;
    const camX = 0, camY = 0;
    const wx = cursor.x * tanF * aspect * CAMZ, wy = cursor.y * tanF * CAMZ;
    if (mode === 2 && !reduced) fluidStep(dt, cursor.x, cursor.y);
    dyeStep(dt);
    if (mode === 3) flockSplat(camX, camY);
    // 1. движение
    gl.useProgram(simP); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
    gl.uniform1i(U(simP, 'uParticleCount'), N); gl.uniform1i(U(simP, 'uParticleWidth'), W);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(U(simP, 'uPos'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, velTex[cur]); gl.uniform1i(U(simP, 'uVel'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mode === 3 ? flock.t : fluidVel[fv].t); gl.uniform1i(U(simP, 'uField'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, maskSoftTex); gl.uniform1i(U(simP, 'uMaskSoft'), 3);
    gl.uniform1f(U(simP, 'uTime'), time); gl.uniform1f(U(simP, 'uDt'), reduced ? 0 : dt); gl.uniform1f(U(simP, 'uSpawnNear'), .7); gl.uniform1f(U(simP, 'uMode'), mode);
    gl.uniform3f(U(simP, 'uCursor'), wx, wy, 0); gl.uniform3f(U(simP, 'uBox'), BOX[0], BOX[1], BOX[2]); gl.uniform1f(U(simP, 'uCursorOn'), cursor.on);
    gl.uniform3f(U(simP, 'uCam'), camX, camY, CAMZ); gl.uniform1f(U(simP, 'uAspect'), aspect); gl.uniform1f(U(simP, 'uTanF'), tanF); gl.uniform1f(U(simP, 'uCamZ'), CAMZ);
    gl.uniform2f(U(simP, 'uRes'), canvas.width, canvas.height); gl.uniform2f(U(simP, 'uMarkPos'), mark.x * dpr, mark.y * dpr); gl.uniform2f(U(simP, 'uMarkSize'), mark.w * dpr, mark.h * dpr);
    gl.uniform2f(U(simP, 'uSoftStep'), 2.7 / Math.max(1, maskSoftCanvas.width), 2.7 / Math.max(1, maskSoftCanvas.height)); gl.uniform2f(U(simP, 'uFieldScale'), 2 * tanF * aspect * CAMZ * 1.6, 2 * tanF * CAMZ * 1.6); gl.uniform2f(U(simP, 'uFieldTexel'), 1 / FLOCK_W, 1 / FLOCK_H); gl.uniform1f(U(simP, 'uTarget'), flockTarget);
    gl.drawArrays(gl.TRIANGLES, 0, 3); cur = 1 - cur;
    // 2. накопление облака
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo); gl.viewport(0, 0, accW, accH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(ptsP); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(U(ptsP, 'uPos'), 0);
    gl.uniform1i(U(ptsP, 'uW'), W); gl.uniformMatrix4fv(U(ptsP, 'uProj'), false, proj); gl.uniform3f(U(ptsP, 'uCam'), camX, camY, CAMZ);
    // Viktor's original compensation: diameter ∝ N^(-1/4), brightness ∝ N^(-1/2).
    const k = 1048576 / (particleSizing === 'fixed' ? defaultParticleCount : N);
    gl.uniform1f(U(ptsP, 'uSize'), 9.5 * Math.pow(k, .25)); gl.uniform1f(U(ptsP, 'uFocus'), 0); gl.uniform1f(U(ptsP, 'uDpr'), dpr * accScale());
    gl.uniform1f(U(ptsP, 'uAlpha'), .045 * Math.sqrt(k) * (mode === 4 ? (dark ? 1.5 : 2.1) : 1)); gl.uniform3f(U(ptsP, 'uCursor'), wx, wy, 0); gl.uniform1f(U(ptsP, 'uTime'), time);
    gl.drawArrays(gl.POINTS, 0, N);
    if (!draw) return;
    // 2б. сглаженная плотность
    gl.bindFramebuffer(gl.FRAMEBUFFER, softFbo); gl.viewport(0, 0, softW, softH); gl.disable(gl.BLEND);
    gl.useProgram(blitP); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(U(blitP, 'uSrc'), 0); gl.uniform2f(U(blitP, 'uTexel'), 1 / accW, 1 / accH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 3. сборка
    if (!stillImage && videoOn && video.readyState >= 2 && video.currentTime !== lastVideoT) { lastVideoT = video.currentTime; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, videoTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND);
    gl.useProgram(compP);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(U(compP, 'uAcc'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(U(compP, 'uMask'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, videoTex); gl.uniform1i(U(compP, 'uVideo'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, softTex); gl.uniform1i(U(compP, 'uSoft'), 3);
    gl.uniform2f(U(compP, 'uRes'), canvas.width, canvas.height); gl.uniform2f(U(compP, 'uMarkPos'), mark.x * dpr, mark.y * dpr); gl.uniform2f(U(compP, 'uMarkSize'), mark.w * dpr, mark.h * dpr);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, dye[dyeIndex].t); gl.uniform1i(U(compP, 'uDye'), 4);
    gl.uniform1f(U(compP, 'uDark'), dark ? 1 : 0); gl.uniform1f(U(compP, 'uVideoOn'), (stillImage ? stillReady : videoOn) && videoWanted ? 1 : 0);
    gl.uniform1f(U(compP, 'uInspectFull'), inspectFull ? 1 : 0);
    gl.uniform1f(U(compP, 'uInspectOutline'), inspectOutline ? 1 : 0);
    gl.uniform1f(U(compP, 'uDensK'), dark ? 1.05 : .75); gl.uniform1f(U(compP, 'uLetters'), lettersWanted ? 1 : 0);
    gl.uniform1f(U(compP, 'uFade'), particleFade); gl.uniform1f(U(compP, 'uBlurPx'), blur * dpr);
    gl.uniform1f(U(compP, 'uSharpRadius'), sharpRadius); gl.uniform1f(U(compP, 'uEdgeBlur'), edgeBlur);
    gl.uniform1f(U(compP, 'uFocusGraphic'), focusGraphic);
    gl.uniform1f(U(compP, 'uGraphicOpacity'), graphicOpacity);
    gl.uniform1f(U(compP, 'uGraphicSearch'), reduced ? 0 : Math.min(1, blur / 5));
    gl.uniform1f(U(compP, 'uGraphicLock'), graphicLockTime === null ? 0 : 1);
    gl.uniform1f(U(compP, 'uGraphicFade'), reduced || graphicLockTime === null ? 1 : .3 + .7 * Math.exp(-(time - graphicLockTime) * 2.8));
    gl.uniform1f(U(compP, 'uGraphicTime'), graphicLockTime ?? time);
    gl.uniform1f(U(compP, 'uGraphicColor'), graphicColor ? 1 : 0);
    gl.uniform1f(U(compP, 'uGraphicDpr'), dpr);
    gl.uniform2f(U(compP, 'uRadius'), radiusPx() * dpr, radiusYPx() * dpr); gl.uniform1f(U(compP, 'uFeather'), feather);
    gl.uniform1f(U(compP, 'uMaskView'), maskView ? 1 : 0);
    gl.uniform1f(U(compP, 'uMaskPresence'), maskPresence);
    gl.uniform2f(U(compP, 'uCursorPx'), maskCursor.x * dpr, maskCursor.y * dpr);
    // Весь ролик — одна плоскость с исходными пропорциями. Никакой привязки отдельных букв.
    const vw = stillImage?.naturalWidth || stillImage?.width || video.videoWidth || 1280, vh = stillImage?.naturalHeight || stillImage?.height || video.videoHeight || 720;
    let planeW = canvas.width * (stillImage ? .88 : 1.0), planeH = planeW * vh / vw;
    let planeX = (canvas.width - planeW) / 2, planeY = canvas.height * .46 - planeH / 2;
    // Registered media share the same word coordinates; legacy video keeps its original placement.
    const registeredFrame = stillImage ? opts.stillFrame : opts.videoFrame;
    if (registeredFrame) {
      const f = registeredFrame, [x,y,w,h] = f.word;
      const wordW = Math.min(innerWidth * .84, 1320) * f.scale * dpr;
      const wordH = wordW * MH / MW;
      planeW = wordW * f.width / w; planeH = wordH * f.height / h;
      planeX = (canvas.width - wordW) / 2 - x * planeW / f.width;
      planeY = canvas.height * .46 - wordH / 2 - y * planeH / f.height;
    }
    gl.uniform4f(U(compP, 'uVideoRect'), planeX, planeY, planeW, planeH);
    gl.uniform2f(U(compP, 'uVideoSize'), vw, vh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let last = 0, frames = 0, fpsT = 0, fps = 0;
  function frame(now) {
    if (!running || paused || document.hidden || contextLost) return;
    const dt = Math.min(.05, last ? (now - last) / 1000 : 1 / 60); last = now;
    frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; stat.textContent = rendererShort + ' · ' + N.toLocaleString('ru-RU') + ' частиц · ' + fps + ' к/с'; }
    if (auto && time > 2) { if (dt > .022) { if (!slowSince) slowSince = now; else if (now - slowSince > 2000 && level < LEVELS.length - 1) { build(level + 1); slowSince = 0; } } else slowSince = 0; }
    if (fadeStart) { const q = Math.min(1, Math.max(0, (now - fadeStart) / 1500)); particleFade = q * q * (3 - 2 * q); if (q >= 1) fadeStart = 0; }
    step(dt, true);
    opts.onFocus?.({
      phase: focus?.phase || 'locked', blur: focus?.blur || 0, speed, overLetter,
      time, reduced,
      mask: { x: maskCursor.x, y: maskCursor.y, radiusX: radiusPx(), radiusY: radiusYPx(), presence: maskPresence }
    });
    if (running && !paused && !document.hidden && !contextLost) frameId = requestAnimationFrame(frame);
  }
  let running = false;
  function resume() {
    if (!running || paused || document.hidden || contextLost) return;
    last = 0; cancelAnimationFrame(frameId);
    if (videoOn && !videoPaused && !reduced) video.play().catch(() => {});
    frameId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frameId); video.pause(); }
    else resume();
  });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextLost = true; cancelAnimationFrame(frameId); video.pause();
    opts.onError?.('context');
  });
  const api = {
    start() {
      if (running) return;
      build(mobile ? 3 : 2); setMode(2); particleFade = 1; running = true; resume();
    },
    setDark(v) { dark = !!v; },
    setParticleCount(value) {
      if (!Number.isFinite(value)) return particleStats();
      auto = false;
      const count = Math.round(Math.max(Math.ceil(defaultParticleCount * .05), Math.min(2097152, value)));
      // Reuse the current pool; allocate a larger original tier only when needed.
      if (W * H < count) {
        const tier = LEVELS.findLastIndex(item => item.w * item.h >= count);
        build(tier);
      }
      if (N !== count) {
        N = count; flockTarget = 9 * N / (FLOCK_W * FLOCK_H) * 1.4;
        opts.onParticles?.(particleStats());
      }
      return particleStats();
    },
    setParticleSizing(value) {
      particleSizing = value === 'fixed' ? 'fixed' : 'viktor';
      opts.onParticles?.(particleStats());
      return particleStats();
    },
    setMarkStyle(scale = 1, width = 1, spacing = 1) {
      markScale = Math.max(1, Math.min(1.6, scale)); glyphWidth = Math.max(1, Math.min(1.3, width));
      glyphSpacing = Math.max(.4, Math.min(1.2, spacing));
      layoutMark(); rasterMask(); rasterMaskSoft();
    },
    setInspection(full = false, outline = false) { inspectFull = !!full; inspectOutline = !!outline; },
    setStillSource(url, compose = null) {
      const request = ++stillRequest;
      video.pause(); videoPaused = true; stillReady = false;
      const next = new Image(); stillImage = next;
      return new Promise((resolve, reject) => {
        next.onload = () => {
          if (request !== stillRequest) { resolve(false); return; }
          const source = compose ? compose(next) : next;
          stillImage = source;
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, videoTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
          stillReady = true; opts.onMedia?.('ready'); resolve(true);
        };
        next.onerror = () => { if (request === stillRequest) opts.onMedia?.('error'); reject(new Error('Still image unavailable')); };
        next.src = url;
      });
    },
    setRadius(v) { radiusScale = Math.max(.6, Math.min(1.5, v)); },
    setFeather(v) { feather = .02 + Math.max(0, Math.min(1, v)) * .07; },
    setMaskView(v) { maskView = !!v; },
    setPreviewAnchor(point) { previewAnchor = point ? { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } : null; },
    setFocusShape(center, edge) { sharpRadius = Math.max(.05, Math.min(.95, center)); edgeBlur = Math.max(0, Math.min(12, edge)); },
    setFocusGraphic(settings) {
      focusGraphic = settings.style === 'details' ? 1 : settings.style === 'edge' ? 2 : 0;
      graphicOpacity = Math.max(.2, Math.min(1, settings.opacity));
      graphicColor = !!settings.color;
    },
    setVideoPaused(v) {
      videoPaused = !!v;
      if (videoPaused) video.pause();
      else if (!paused && !reduced && !document.hidden) video.play().catch(() => opts.onMedia?.('blocked'));
    },
    setPaused(v) { paused = !!v; if (paused) { cancelAnimationFrame(frameId); video.pause(); } else resume(); },
    setVideoSource(url) {
      stillRequest++; stillImage = null; stillReady = false;
      video.pause(); videoOn = false; lastVideoT = -1; video.src = url; video.load();
    },
    setKeyboardPoint(x, y) {
      pointer.x = x; pointer.y = y; pointer.on = 1; pointer.canReveal = true; demo = false;
      pointer.clientX = (x + 1) / 2 * innerWidth; pointer.clientY = (1 - y) / 2 * innerHeight;
    },
    get stats() { return { ...particleStats(), fps, n: N, maxParticles: defaultParticleCount, mobile, mode, speed, phase: focus?.phase, blur: focus?.blur }; }
  };
  return api;
}
  return { create };
})();
