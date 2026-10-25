const toggle=document.querySelector('#contact-toggle');
const card=document.querySelector('#contact-card');
if(toggle&&card){
  const bubble=document.createElement('div');
  bubble.className='contact-bubble';
  bubble.setAttribute('aria-hidden','true');
  bubble.innerHTML='<span>↗</span>';
  document.body.append(bubble);
  const finePointer=matchMedia('(hover:hover) and (pointer:fine)');
  const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)');
  const hideBubble=()=>bubble.classList.remove('is-visible');
  const syncBubble=()=>{card.classList.toggle('has-bubble',finePointer.matches&&!reduceMotion.matches);hideBubble();};
  syncBubble();
  finePointer.addEventListener('change',syncBubble);
  reduceMotion.addEventListener('change',syncBubble);
  function show(open,restoreFocus=true){
    card.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
    hideBubble();
    if(open)card.querySelector('a').focus({preventScroll:true});
    else if(restoreFocus)toggle.focus({preventScroll:true});
  }
  toggle.addEventListener('click',()=>show(card.hidden));
  document.querySelector('#contact-close').addEventListener('click',()=>show(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!card.hidden){event.preventDefault();show(false);}});
  document.addEventListener('pointerdown',event=>{
    if(!card.hidden&&!card.contains(event.target)&&!toggle.contains(event.target))show(false,false);
  });
  document.addEventListener('focusin',event=>{
    if(!card.hidden&&!card.contains(event.target)&&!toggle.contains(event.target))show(false,false);
  });
  for(const link of card.querySelectorAll('a')){
    link.addEventListener('pointermove',event=>{
      if(!card.classList.contains('has-bubble')||event.pointerType==='touch')return;
      const x=Math.max(8,Math.min(innerWidth-46,event.clientX+18));
      const y=Math.max(8,Math.min(innerHeight-46,event.clientY-46));
      bubble.style.transform=`translate(${x}px,${y}px)`;
      bubble.classList.add('is-visible');
    });
    link.addEventListener('pointerleave',hideBubble);
    link.addEventListener('click',()=>show(false));
  }
  document.addEventListener('visibilitychange',hideBubble);
  addEventListener('blur',hideBubble);
}
