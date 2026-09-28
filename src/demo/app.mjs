// Two public cities through CityKit's streaming runtime (WebGL2).
import * as THREE from 'three';
import {fetchVerified} from '../citykit/streamer.mjs';
import {openBuildingStream} from '../citykit/building-stream.mjs';
import {loadSignAtlas} from '../citykit/facade-three.mjs';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {ThreeCityAdapter,toRender} from '../citykit/three-adapter.mjs';
import {CityNavigator,heightAt,insideBuilding} from '../citykit/navigation.mjs';

const $=id=>document.getElementById(id);
const CITY=new URLSearchParams(location.search).get('city')==='onkyo'?'onkyo':'griffin';
const MANIFEST=new URL(`../data/${CITY}/manifest.json`,location.href);
const BUILDINGS=new URL(`../data/${CITY}/buildings/hierarchy.json`,location.href);
const FAR=CITY==='onkyo'?new URL('../data/onkyo/far/hierarchy.json',location.href):null;
const SIGNS=new URL(`../data/${CITY}/signs/`,location.href);
const keys=new Set(),taps=new Set(),held=new Set();
let place,manifest,fallback,adapter,ghostProxyMaterial,city,farCity,navigator,renderer,scene,camera,sun,ambient,ktx,signAtlas,last=0,lastUI=0,drag=null,lighting='golden',siteMapMarker,siteMapPosition;
let lastBuildingSwaps=-1,lastFarSwaps=-1,buildingNodes,farNodes;
const cells=new Map(); // Legacy massing stays visible until the first prepared CityKit cover arrives.
const MOVE=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','KeyZ','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

function cellAt(x,y){const s=manifest.cell_m;return cells.get(`${Math.floor(x/s)}:${Math.floor(y/s)}`);}
function ground(x,y){const c=cellAt(x,y);return c?heightAt(c,x,y):null;}
function surface(x,y){return ground(x,y);}
function blocked(x,y,z,r){
  const s=manifest.cell_m,ix=Math.floor(x/s),iy=Math.floor(y/s);
  for(let i=ix-1;i<=ix+1;i++)for(let j=iy-1;j<=iy+1;j++){
    const id=`${i}:${j}`,c=cells.get(id);if(!c)continue;
    for(const b of c.buildings)if(insideBuilding(b,x-c.origin[0],y-c.origin[1],z,r))return true;
  }
  return false;
}
function input(){
  const has=c=>keys.has(c)||taps.has(c)||held.has(c);
  return {forward:Number(has('KeyW')||has('ArrowUp'))-Number(has('KeyS')||has('ArrowDown')),
    right:Number(has('KeyD')||has('ArrowRight'))-Number(has('KeyA')||has('ArrowLeft')),
    up:Number(has('Space')||has('KeyE'))-Number(has('KeyZ')||has('KeyQ')),
    fast:has('ShiftLeft')||has('ShiftRight')};
}
function setMode(m){
  if(!navigator.setMode(m)){$('notice').textContent='Move over the town before walking: street level needs ground below you.';return false;}
  $('walk').setAttribute('aria-pressed',m==='walk');$('fly').setAttribute('aria-pressed',m==='fly');
  $('notice').textContent=m==='walk'?'Walking follows the ground. Buildings block the way.':'';
  document.body.dataset.mode=m;return true;
}
// A street point near the centre: the midpoint of the nearest road ribbon to the plan's centre.
function streetStart(){
  const [cx,cy]=centre();let best=null,bd=Infinity;
  for(const c of fallback.cells)for(const r of c.roads){
    const [a,b]=r.points,m=[(a[0]+b[0])/2,(a[1]+b[1])/2],d=Math.hypot(m[0]-cx,m[1]-cy);
    if(d<bd&&r.width>=6){bd=d;best={m,yaw:Math.atan2(-(b[0]-a[0]),b[1]-a[1])};}
  }
  return best;
}
const PLACES={
  above:{label:'Above downtown',go(){const [cx,cy]=centre(),a=place.above,at=a?.at||[cx-120,cy-520],g=ground(...at)??0;
    put([at[0],at[1],g+(a?.height??170)],a?.yaw??-0.22,a?.pitch??-0.34,'fly');}},
  street:{label:'Street level, near downtown',go(){const s=place.street?{m:place.street.at,yaw:place.street.yaw}:streetStart();if(!s)return PLACES.above.go();put([s.m[0],s.m[1],(ground(...s.m)??0)+1.65],s.yaw,-0.04,'walk');}},
  town:{label:'The whole town',go(){const b=manifest.coverage.bounds,[cx,cy]=centre(),span=Math.max(b[2]-b[0],b[3]-b[1]),g=ground(cx,cy)??0;put([cx,cy-span*0.36,g+span*0.26],0,-0.62,'fly');}},
};
function centre(){const b=manifest.coverage.bounds;return place.centre||[(b[0]+b[2])/2,(b[1]+b[3])/2];}
function buildSiteMap(){
  if(CITY!=='onkyo')return;
  $('site-map').hidden=false;
  const svg=$('site-outlines'),ns='http://www.w3.org/2000/svg',b=manifest.coverage.bounds;
  const spanX=b[2]-b[0],spanY=b[3]-b[1],w=300,h=Math.round(300*spanY/spanX);
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  siteMapPosition=(x,y)=>[(x-b[0])/spanX*w,(b[3]-y)/spanY*h];
  const sites=new Map();
  for(const cell of fallback.cells)for(const box of cell.buildings){
    if(!box.site||box.kind!=='massing'||box.w<=0||box.d<=0||box.h<=0)continue;
    const x=cell.origin[0]+box.x,y=cell.origin[1]+box.y,c=Math.cos(box.yaw),s=Math.sin(box.yaw);
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>siteMapPosition(x+c*u*box.w/2-s*v*box.d/2,y+s*u*box.w/2+c*v*box.d/2));
    const polygon=document.createElementNS(ns,'polygon');polygon.setAttribute('class','site');
    polygon.setAttribute('points',corners.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' '));svg.append(polygon);
    const record=sites.get(box.site)||{x:0,y:0,count:0};record.x+=x;record.y+=y;record.count++;sites.set(box.site,record);
  }
  const labels={'joon-shotengai':'Jōon shops','joon-hall':'Jōon Hall','akibakohara':'Akibakohara',
    'conservatory':'Conservatory','onchinomizu':'Onchinomizu','cat-shrine':'Cat Shrine'};
  for(const [id,record] of sites){const name=labels[id];if(!name)continue;
    const [x,y]=siteMapPosition(record.x/record.count,record.y/record.count);
    const label=document.createElementNS(ns,'text');label.setAttribute('class','site-label');label.setAttribute('x',x.toFixed(2));
    label.setAttribute('y',y.toFixed(2));label.textContent=name;svg.append(label);
  }
  siteMapMarker=document.createElementNS(ns,'circle');siteMapMarker.setAttribute('class','you');siteMapMarker.setAttribute('r','3');svg.append(siteMapMarker);
}
function put(p,yaw,pitch,mode){
  keys.clear();held.clear();setMode('fly');navigator.position=[...p];navigator.yaw=yaw;navigator.pitch=pitch;
  if(mode==='walk')setMode('walk');
}
function go(id){const p=PLACES[id];if(!p)return;p.go();$('place').value=id;$('location').textContent=p.label;}

function setLighting(value){
  lighting=value;const night=value==='night';
  $('day').setAttribute('aria-pressed',!night);$('night').setAttribute('aria-pressed',night);
  const clock={night:night?1:0,electric_gain:night?1:0,sun_az:235,sun_el:night?-8:14,sun:night?0:1,
    schedule:{residential:.55,early:.3,office:.3,nightlife:1,industrial:.3,suburban:.45}};
  city?.time(clock);farCity?.time(clock);
  sun.intensity=night?0:2.9;ambient.intensity=night?.10:1.4;
  renderer.toneMappingExposure=night?4:1.15;
  const sky=new THREE.Color(night?0x10192a:0xe8bd8e);scene.background=sky;scene.fog.color.copy(sky);
}

function frame(time){
  requestAnimationFrame(frame);
  if(document.hidden){last=0;return;}
  const dt=last?Math.min(.1,(time-last)/1000):0;last=time;
  navigator.step(dt,input());taps.clear();
  const p=navigator.position;
  city?.update({position:p,velocity:navigator.velocity});
  farCity?.update({position:p,velocity:navigator.velocity});
  if(city&&(city.streamer.swaps!==lastBuildingSwaps||farCity?.streamer.swaps!==lastFarSwaps)){
    lastBuildingSwaps=city.streamer.swaps;lastFarSwaps=farCity?.streamer.swaps??-1;
    const nearCut=[...city.streamer.cut].map(id=>buildingNodes.get(id)).filter(Boolean);
    const fine=nearCut.filter(n=>['L0','L1','L2'].includes(n.level));
    const coarse=nearCut.filter(n=>n.level==='L3');
    // Both exports come from one hierarchy. Hide a far page only when the central
    // cut has prepared the same node (or its finer descendants), never on bounds overlap.
    for(const id of farCity?.streamer.cut||[]){
      const group=farCity.streamer.records.get(id)?.handle?.group;
      if(!group)continue;
      const range=city.streamer.ranges.get(id);
      group.visible=!range||![...city.streamer.cut].some(nearId=>{
        const near=buildingNodes.get(nearId),own=city.streamer.ranges.get(nearId);
        return near&&['L0','L1','L2','L3'].includes(near.level)&&own&&range[0]<=own[0]&&own[0]<range[1];
      });
    }
    for(const id of farCity?.streamer.cut||[]){
      const record=farCity.streamer.records.get(id);
      if(record?.node.level==='L3'&&record.handle?.group.visible!==false)coarse.push(record.node);
    }
    const size=manifest.cell_m;
    for(const cell of fallback.cells){
      const [x,y]=cell.origin,generated=cell.buildings.filter(b=>!b.site);
      const covers=nodes=>{
        const candidates=nodes.filter(n=>{const b=n.bounds;return b[0]<x+size&&b[3]>x&&b[1]<y+size&&b[4]>y;});
        return generated.length>0&&generated.every(building=>{
          const px=x+building.x,py=y+building.y;
          return candidates.some(n=>{const b=n.bounds;return b[0]<=px&&px<=b[3]&&b[1]<=py&&py<=b[4];});
        });
      };
      const state=covers(fine)?'fine':covers(coarse)?'coarse':'fallback';
      // Coarse bounds are only a hint: keep translucent massing until the exact
      // near-cell cover arrives, so an incomplete distant page cannot make a void.
      for(const mesh of adapter.proxies.get(cell.id).children)if(!mesh.userData.citySite){
        mesh.visible=state!=='fine';mesh.material=state==='coarse'?ghostProxyMaterial:adapter.buildingMaterial;
      }
    }
  }
  camera.position.set(...toRender(p));
  const alt=Math.max(1,p[2]-(ground(p[0],p[1])??p[2]));scene.fog.density=Math.min(.00018,.05/alt);   // thinner haze when high up
  camera.lookAt(...toRender([p[0]-Math.sin(navigator.yaw)*Math.cos(navigator.pitch),p[1]+Math.cos(navigator.yaw)*Math.cos(navigator.pitch),p[2]+Math.sin(navigator.pitch)]));
  renderer.render(scene,camera);
  if(time-lastUI>400){
    lastUI=time;const s=combinedStats(),g=ground(p[0],p[1]);
    $('position').textContent=`${p[0].toFixed(0)} m E · ${p[1].toFixed(0)} m N · ${g===null?'—':(p[2]-g).toFixed(0)+' m above ground'}`;
    if(siteMapMarker){const [x,y]=siteMapPosition(p[0],p[1]);siteMapMarker.setAttribute('cx',x);siteMapMarker.setAttribute('cy',y);}
    $('status').textContent=s?`${s.unmetDesired?`Refining · ${s.unmetDesired} areas waiting`:'Detail ready'} · ${city.performanceProfile} tier`:'Massing ready · loading building detail';
    if(navigator.mode==='walk')$('notice').textContent=navigator.lastBlock||'Walking follows the ground. Buildings block the way.';
  }
}
function combinedStats(){
  const a=city?.stats(),b=farCity?.stats();
  return a&&b?{...a,unmetDesired:a.unmetDesired+b.unmetDesired,loading:a.loading+b.loading,
    reservedBytes:a.reservedBytes+b.reservedBytes,errors:[...a.errors,...b.errors]}:a;
}
function fail(e){console.error(e);$('progress').textContent=`The city could not load: ${e.message}. Reload the page to try again.`;$('status').textContent='Not loaded';}

async function main(){
  const probe=document.createElement('canvas').getContext('webgl2');
  if(!probe)throw Error('this browser has no WebGL2, which the demo needs');
  $('city').value=CITY;
  document.title=`${CITY==='onkyo'?'Onkyō':'Griffin'} in CityKit`;
  $('city-name').textContent=CITY==='onkyo'?'Onkyō':'Griffin, Georgia';
  $('view').setAttribute('aria-label',`Explore ${CITY==='onkyo'?'Onkyō':'Griffin, Georgia'} in 3D. Drag to look around; use W A S D or arrow keys to move.`);
  $('placeholder-note').hidden=CITY!=='griffin';
  $('credit').innerHTML=CITY==='onkyo'?'Fictional city · procedural buildings, streets and terrain by CityKit':
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · OSM data under <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a> · Elevation and lidar: <a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS 3DEP</a>';
  $('progress').textContent='Loading the town outline…';
  place=await (await fetch(new URL('place.json',MANIFEST))).json();
  manifest=await (await fetch(MANIFEST)).json();
  fallback=await fetchVerified(manifest.fallback,MANIFEST);
  for(const c of fallback.cells)cells.set(c.id,c);
  buildSiteMap();
  renderer=new THREE.WebGLRenderer({canvas:$('view'),antialias:true,stencil:true,logarithmicDepthBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;
  scene=new THREE.Scene();const sky=new THREE.Color(0xdfe6e2);scene.background=sky;scene.fog=new THREE.FogExp2(sky,.00018);
  ambient=new THREE.HemisphereLight(0xffe6c5,0x514c48,1.4);scene.add(ambient);
  sun=new THREE.DirectionalLight(0xffcf91,2.9);sun.position.set(-500,240,320);scene.add(sun);
  camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.3,30000);
  adapter=new ThreeCityAdapter(scene,manifest,fallback);
  ghostProxyMaterial=adapter.buildingMaterial.clone();ghostProxyMaterial.transparent=true;ghostProxyMaterial.opacity=.32;ghostProxyMaterial.depthWrite=false;
  navigator=new CityNavigator({surface,blocked});
  const b=manifest.coverage.bounds;
  $('coverage').textContent=`${((b[2]-b[0])/1000).toFixed(1)} × ${((b[3]-b[1])/1000).toFixed(1)} km · generated buildings`;
  for(const [id,p] of Object.entries(PLACES))$('place').append(new Option(p.label,id));
  go('above');setLighting('golden');
  window.citykit={go,put,ground,centre,setLighting,streamStats:combinedStats,
    streamStatsDetail:()=>({central:city?.stats(),far:farCity?.stats()})};
  window.griffin=window.citykit; // Existing local capture harness.
  $('splash').hidden=true;requestAnimationFrame(frame);
  try{
    ktx=new KTX2Loader().setTranscoderPath(new URL('./basis/',import.meta.url).href).setWorkerLimit(2).detectSupport(renderer);
    const memory=globalThis.navigator.deviceMemory||0,requested=new URLSearchParams(location.search).get('profile');
    const performanceProfile=requested||((memory&&memory<=8)||innerWidth<1600?'low':'desktop');
    const low=performanceProfile==='low',mib=1024**2;
    const open=(url,outer=false)=>openBuildingStream({manifestURL:url.href,renderer,scene,camera,ktx2Loader:ktx,
      decoderURL:new URL('./meshopt_decoder.module.js',import.meta.url).href,performanceProfile,tier:'low',
      ...(FAR?{budgetBytes:low?(outer?686:850)*mib:2*1024**3,
        ...(low?{refineRadii:outer?{L1:80,L2:300,L3:600,HORIZON:900}:
          {L1:80,L2:300,L3:700,HORIZON:1200}}:{})}:{}),
      surfaceAt:(x,y)=>ground(x,y),concurrency:2,uploadBudgetMs:3});
    [city,farCity]=await Promise.all([open(BUILDINGS),FAR?open(FAR,true):Promise.resolve(null)]);
    buildingNodes=new Map(city.manifest.nodes.map(node=>[node.id,node]));
    farNodes=farCity?new Map(farCity.manifest.nodes.map(node=>[node.id,node])):null;
    $('coverage').textContent=`${((b[2]-b[0])/1000).toFixed(1)} × ${((b[3]-b[1])/1000).toFixed(1)} km · ${city.manifest.source.buildings.toLocaleString('en-US')} ${CITY==='onkyo'?'central':'generated'} buildings`;
    setLighting(lighting);
    signAtlas=await loadSignAtlas(THREE,SIGNS.href,{ktx2Loader:ktx});
    city.uniforms.uFcSigns.value=signAtlas;
  }catch(error){console.error(error);$('status').textContent=`Building detail unavailable: ${error.message}`;}
}

$('day').onclick=()=>setLighting('golden');
$('night').onclick=()=>setLighting('night');
$('city').onchange=()=>{location.href=`?city=${$('city').value}${new URLSearchParams(location.search).has('profile')?'&profile='+new URLSearchParams(location.search).get('profile'):''}`;};
$('walk').onclick=()=>{setMode('walk');$('view').focus();};
$('fly').onclick=()=>{setMode('fly');$('view').focus();};
$('place').onchange=()=>{go($('place').value);$('view').focus();};
$('panel-toggle').onclick=()=>{const open=$('panel').toggleAttribute('data-open');$('panel-toggle').setAttribute('aria-expanded',open);};
$('view').addEventListener('pointerdown',e=>{$('view').focus();drag=[e.clientX,e.clientY];$('view').setPointerCapture(e.pointerId);});
$('view').addEventListener('pointermove',e=>{if(!drag||!navigator)return;navigator.look(e.clientX-drag[0],e.clientY-drag[1]);drag=[e.clientX,e.clientY];});
$('view').addEventListener('pointerup',()=>drag=null);$('view').addEventListener('pointercancel',()=>drag=null);
for(const btn of document.querySelectorAll('[data-key]')){
  const k=btn.dataset.key,on=e=>{e.preventDefault();held.add(k);},off=()=>held.delete(k);
  btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointerleave',off);btn.addEventListener('pointercancel',off);
}
addEventListener('keydown',e=>{
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Space'&&e.target.tagName==='BUTTON')return;
  if(MOVE.has(e.code)){keys.add(e.code);taps.add(e.code);e.preventDefault();}
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();taps.clear();held.clear();drag=null;});
addEventListener('pagehide',()=>{void city?.close();void farCity?.close();ktx?.dispose();signAtlas?.dispose();ghostProxyMaterial?.dispose();});
addEventListener('resize',()=>{if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
if(innerWidth<640){$('panel').removeAttribute('data-open');$('panel-toggle').setAttribute('aria-expanded','false');}
main().catch(fail);
