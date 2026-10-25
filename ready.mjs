import { LabFocusModel } from './focus-lab-model.mjs';
import { FocusReticle } from './focus-reticle.mjs';
import { createBrandLockup } from './brand-lockup.mjs';
import { PARTICLE_KEY, applyParticleSettings, createParticleControls } from './particle-settings.mjs';

const message=document.querySelector('#playback-message');
const branding=createBrandLockup();
let engine;
let particleControls;
function fail(){
  document.body.classList.remove('ready');
  message.textContent='Не удалось запустить эффект. Обнови страницу.';
  message.hidden=false;
}
try{
  const response=await fetch('approved-settings.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Нет сохранённых настроек');
  const settings=await response.json();
  const focus=new LabFocusModel(settings.focus);
  const reticle=new FocusReticle(document.querySelector('#focus-reticle'));
  reticle.configure(settings.reticle);
  engine=PortnoyParticles.create(document.querySelector('#scene'),{
    // Телефону и узкому экрану — ролик 1080p (10 МБ), десктопу — 4K; критерий тот же, что у движка.
    video:(innerWidth<=720||/Mobi|Android/i.test(navigator.userAgent))&&settings.videoMobile?settings.videoMobile:settings.video,videoFrame:settings.videoFrame,
    focus,dark:settings.dark,autoParticles:false,
    onMarkLayout:branding.layout,
    onParticles:state=>{particleControls?.update(state);document.querySelector('#scene').dataset.particles=state.count;document.querySelector('#scene').dataset.particleSize=state.sizeRatio;},
    onFocus:state=>reticle.update(state),onError:fail,
    onMedia:status=>{
      if(status==='error')fail();
      if(status==='ready'){message.hidden=true;document.body.classList.add('ready');}
      if(status==='blocked'){message.textContent='Коснись экрана, чтобы включить видео.';message.hidden=false;}
    }
  });
  if(!engine)fail();
  else{
    engine.setRadius(settings.mask.radius);engine.setFeather(settings.mask.feather);
    engine.setFocusShape(settings.focus.center,settings.focus.edge);
    engine.setMarkStyle(settings.letters.size/100,settings.letters.width/100,settings.letters.spacing/100);
    engine.start();
    applyParticleSettings(engine);
    document.body.classList.add('ready');
  }
}catch(error){console.error(error);fail();}
addEventListener('storage',event=>{if(engine&&(event.key===PARTICLE_KEY||event.key===null))applyParticleSettings(engine);});

const stage=document.querySelector('#stage');
stage.addEventListener('pointerdown',()=>{
  engine?.setVideoPaused(false);
  if(message.textContent.startsWith('Коснись'))message.hidden=true;
});
const point={x:0,y:0};
stage.addEventListener('keydown',event=>{
  const delta={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,.12],ArrowDown:[0,-.12]}[event.key];
  if(!delta)return;event.preventDefault();
  point.x=Math.max(-.9,Math.min(.9,point.x+delta[0]));
  point.y=Math.max(-.8,Math.min(.8,point.y+delta[1]));
  engine?.setKeyboardPoint(point.x,point.y);
});

// Панель есть только в отдельной версии настройки частиц.
const particlePanel=document.querySelector('#settings');
const particleToggle=document.querySelector('#particle-panel-toggle');
if(particlePanel){
  particleControls=createParticleControls(document.querySelector('#particle-controls'),value=>{
    if(engine)particleControls.update(applyParticleSettings(engine,value));
  });
  if(engine)particleControls.update(engine.stats);
  function showParticlePanel(open,restoreFocus=true){
    if(open&&document.querySelector('#contact-toggle')?.getAttribute('aria-expanded')==='true')document.querySelector('#contact-toggle').click();
    particlePanel.hidden=!open;particleToggle.setAttribute('aria-expanded',String(open));
    if(open){
      document.querySelector('#particle-panel-close').focus();
    }else if(restoreFocus)particleToggle.focus();
  }
  document.querySelector('#contact-toggle')?.addEventListener('click',()=>{if(!particlePanel.hidden)showParticlePanel(false,false);});
  particleToggle.addEventListener('click',()=>showParticlePanel(particlePanel.hidden));
  document.querySelector('#particle-panel-close').addEventListener('click',()=>showParticlePanel(false));
  addEventListener('keydown',event=>{if(event.key==='Escape'&&!particlePanel.hidden)showParticlePanel(false);});
}
