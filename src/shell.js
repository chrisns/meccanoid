export function setupShell({robot,studio,run,practice}) {
  const $=id=>document.getElementById(id);
  $('practiceBanner').hidden=!practice;
  if(practice)$('practice').textContent='You’re in practice mode';
  $('practice').onclick=()=>{if(!robot.connected)location.search='?practice=1';};
  const aliases={jointsPanel:'move',mirrorPanel:'copy',posesPanel:'create',soundsPanel:'play',diagnosticsPanel:'workshop',lightsPanel:'play'};
  let active;
  const route=()=>{
    const hash=location.hash.slice(1)||'play';
    const next=aliases[hash]??(['play','move','copy','create','workshop'].includes(hash)?hash:'play');
    if(active&&active!==next)run(()=>studio.navigate());
    document.querySelectorAll('[data-page]').forEach(el=>el.hidden=el.dataset.page!==next);
    document.querySelectorAll('[data-view]').forEach(el=>{if(el.dataset.view===next)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    if(active!==next&&active){$('content').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
    active=next;
    if(aliases[hash])requestAnimationFrame(()=>$(hash)?.scrollIntoView({block:'start'}));
  };
  addEventListener('hashchange',route);route();
  robot.addEventListener('state',()=>{if(practice&&robot.connected)$('status').textContent='Practice robot · on screen only';});
  if(practice)robot.addEventListener('tx',({detail:p})=>{
    if(p[0]===25){
      if(p[1]===3)$('practiceAction').textContent='Practice joke: Why did the robot go on holiday? It needed to recharge its batteries.';
      else if([13,14,15,16].includes(p[1]))$('practiceAction').textContent=`Practice move: ${ {13:'forwards',14:'backwards',15:'turn left',16:'turn right'}[p[1]] }.`;
      else if(p[1]===8)$('practiceAction').textContent='Practice robot stopped.';
      else if(p[1]===1)$('practiceAction').textContent='Practice: Hello, human! Ready to make something?';
    }
  });
}
