// Two public cities through CityKit's streaming runtime (WebGL2).
import * as THREE from 'three';
import {fetchVerified} from '../citykit/streamer.mjs';
import {openBuildingStream} from '../citykit/building-stream.mjs';
import {loadSignAtlas} from '../citykit/facade-three.mjs';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {ThreeCityAdapter,toRender} from '../citykit/three-adapter.mjs';
import {CityNavigator,heightAt,insideBuilding} from '../citykit/navigation.mjs';
import {RailRoute,TrainJourney} from '../citykit/transit.mjs';
import {RailwayView,TrainView} from '../citykit/transit-three.mjs';
import {StockLibrary} from '../citykit/rolling-stock-three.mjs';
import {openCityTerrain} from '../citykit/city-terrain.mjs';
import {openSkyline} from '../citykit/skyline.mjs';

const $=id=>document.getElementById(id);
const CITY=new URLSearchParams(location.search).get('city')==='onkyo'?'onkyo':'griffin';
const DATA=CITY==='onkyo'?'onkyo-full':CITY;
const MANIFEST=new URL(`../data/${DATA}/manifest.json`,location.href);
const BUILDINGS=new URL(`../data/${DATA}/buildings/hierarchy.json?v=train-textured-2`,location.href);
const FAR=null;
const SIGNS=new URL(`../data/${DATA}/signs/`,location.href);
const TERRAIN=new URL('../horizon/city-terrain.json',location.href);
const SKYLINE=new URL('../horizon/skyline.json',location.href);
const FLEET=new URL('../rolling-stock/fleet.json',location.href);
const keys=new Set(),taps=new Set(),held=new Set();
let place,manifest,fallback,adapter,city,farCity,navigator,renderer,scene,camera,sun,ambient,ktx,signAtlas,last=0,lastUI=0,lastFarUpdate=0,drag=null,lighting='golden',siteMapMarker,siteMapPosition;
let journey,trainView,stockLibrary,railway,rideCamera=null,rideRate=1;
let cityTerrain,skyline,farLayerMode='far';
const FAR_RING_M=700,FAR_BLEND_M=300,FAR_RADIUS_M=6500;
const rideLook={yaw:0,pitch:0};
const CHASE_DEFAULT={yaw:Math.atan2(65,140),pitch:Math.atan2(30,Math.hypot(140,65)),distance:Math.hypot(140,65,30)};
const chaseLook={...CHASE_DEFAULT};
let lastBuildingSwaps=-1,lastFarSwaps=-1,buildingNodes;
const cells=new Map(); // Building bounds remain available for navigation and the site map, never as visible geometry.
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
  rideCamera=null;if(journey)journey.playing=false;
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
  cityTerrain?.time(clock);skyline?.time(clock);
  sun.intensity=night?0:2.9;ambient.intensity=night?.10:1.4;
  renderer.toneMappingExposure=night?4:1.15;
  const sky=new THREE.Color(night?0x10192a:0xe8bd8e);scene.background=sky;scene.fog.color.copy(sky);
}

function setFarLayerMode(mode){
  farLayerMode=mode;
  const near=mode==='full'?0:mode==='off'?1e9:FAR_RING_M;
  const blend=mode==='far'?FAR_BLEND_M:1;
  cityTerrain?.setNearDistance(near,blend);
  skyline?.setNearDistance(near,blend);
  $('far-layer').value=mode;
  $('far-layer-status').textContent=mode==='far'?'City terrain begins beyond nearby textured buildings.':
    mode==='full'?'Whole height field shown for comparison; nearby buildings may overlap.':
    'Experimental far layer hidden.';
}

async function openFarLayers(){
  if(CITY!=='onkyo')return;
  try{
    cityTerrain=await openCityTerrain({manifestURL:TERRAIN.href,scene,
      maxResidentBytes:new URLSearchParams(location.search).get('profile')==='low'?320*1024**2:512*1024**2,
      radiusM:FAR_RADIUS_M,nearDistanceM:FAR_RING_M,blendWidthM:FAR_BLEND_M,
      coarseTexelSizesM:[32,64],levelDistancesM:[100,700,1800,6000,10000]});
    skyline=await openSkyline({manifestURL:SKYLINE.href,scene,
      nearDistanceM:FAR_RING_M,blendWidthM:FAR_BLEND_M,farDistanceM:FAR_RADIUS_M});
    $('far-layer-panel').hidden=false;
    setFarLayerMode(farLayerMode);
    setLighting(lighting);
  }catch(error){
    cityTerrain?.close();cityTerrain=null;skyline?.close();skyline=null;
    console.error('Far-city preview unavailable',error);
  }
}

function updateTrainCamera(){
  const pose=trainView.passengerPose(),p=pose.position,f=pose.forward,left=pose.left;
  let eye,target;
  if(rideCamera==='chase'){
    target=p.map((v,k)=>v+10*f[k]+(k===2?4:0));
    const horizontal=chaseLook.distance*Math.cos(chaseLook.pitch);
    eye=target.map((v,k)=>v-horizontal*Math.cos(chaseLook.yaw)*f[k]
      +horizontal*Math.sin(chaseLook.yaw)*left[k]
      +(k===2?chaseLook.distance*Math.sin(chaseLook.pitch):0));
  }else{
    eye=p.map((v,k)=>v+0.65*left[k]+(k===2?2.65:0));
    target=eye.map((v,k)=>v+f[k]*Math.cos(rideLook.yaw)*Math.cos(rideLook.pitch)+left[k]*Math.sin(rideLook.yaw)*Math.cos(rideLook.pitch)+(k===2?Math.sin(rideLook.pitch):0));
  }
  const d=target.map((v,k)=>v-eye[k]);
  navigator.position=eye;navigator.yaw=Math.atan2(-d[0],d[1]);navigator.pitch=Math.atan2(d[2],Math.hypot(d[0],d[1]));
  navigator.velocity=f.map(v=>v*journey.state.speed*rideRate);
}
function routeSamples(){
  if(!rideCamera||!journey?.playing)return undefined;
  return [2,4,6,8,10,12].map(etaSeconds=>({etaSeconds,position:journey.evaluate(journey.time+etaSeconds*rideRate).position}));
}
function trainStatus(){
  if(!journey)return;
  const s=journey.state;
  $('train-status').textContent=`${s.from.name.romaji} → ${s.to.name.romaji} · ${(s.speed*3.6).toFixed(0)} km/h${journey.playing?'':' · paused'}`;
  $('train-progress').textContent=`${Math.max(0,s.arrivalIn/rideRate).toFixed(0)} s to next stop · ${s.lap+1} lap`;
  $('train-pause').textContent=journey.playing?'Pause':'Resume';
}
function startRide(){
  if(!journey)return;
  journey.reset($('train-station').value);journey.playing=true;
  rideCamera=$('train-camera').value;rideLook.yaw=1.05;rideLook.pitch=0;Object.assign(chaseLook,CHASE_DEFAULT);
  setMode('fly');updateTrainCamera();keys.clear();taps.clear();$('view').focus();trainStatus();
}

function frame(time){
  requestAnimationFrame(frame);
  if(document.hidden){last=0;return;}
  const dt=last?Math.min(.1,(time-last)/1000):0;last=time;
  if(rideCamera){
    journey.advance(dt*rideRate);trainView.update();
    updateTrainCamera();trainStatus();
  }else{navigator.step(dt,input());}
  taps.clear();
  const p=navigator.position;
  const movement={position:p,velocity:navigator.velocity,routeSamples:routeSamples(),travelSpeedMps:rideCamera?journey.state.speed*rideRate:undefined};
  city?.update(movement);
  farCity?.update(movement);
  cityTerrain?.tick(time);
  if(cityTerrain&&(time-lastFarUpdate>250)){
    lastFarUpdate=time;
    cityTerrain.update(p,{radiusM:FAR_RADIUS_M});
    skyline?.update(p,{farDistanceM:FAR_RADIUS_M});
  }
  if(city&&(city.streamer.swaps!==lastBuildingSwaps||farCity?.streamer.swaps!==lastFarSwaps)){
    lastBuildingSwaps=city.streamer.swaps;lastFarSwaps=farCity?.streamer.swaps??-1;
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
  }
  camera.position.set(...toRender(p));
  const alt=Math.max(1,p[2]-(ground(p[0],p[1])??p[2]));scene.fog.density=Math.min(.00018,.05/alt);   // thinner haze when high up
  camera.lookAt(...toRender([p[0]-Math.sin(navigator.yaw)*Math.cos(navigator.pitch),p[1]+Math.cos(navigator.yaw)*Math.cos(navigator.pitch),p[2]+Math.sin(navigator.pitch)]));
  renderer.render(scene,camera);
  if(time-lastUI>400){
    lastUI=time;const s=combinedStats(),g=ground(p[0],p[1]);
    $('position').textContent=`${p[0].toFixed(0)} m E · ${p[1].toFixed(0)} m N · ${g===null?'—':(p[2]-g).toFixed(0)+' m above ground'}`;
    if(siteMapMarker){const [x,y]=siteMapPosition(p[0],p[1]);siteMapMarker.setAttribute('cx',x);siteMapMarker.setAttribute('cy',y);}
    const far=cityTerrain?.stats();
    $('status').textContent=(s?`${s.unmetDesired?`Refining · ${s.unmetDesired} areas waiting`:'Detail ready'} · ${city.performanceProfile} tier`:'Textured city ready · loading building detail')+
      (far?` · far city ${far.tiles}/${far.desired} tiles`:'');
    if(rideCamera){$('location').textContent='NYAMANOTE · FULL LOOP';$('notice').textContent='The train follows the full loop. Choose a station to start another leg.';}
    else if(navigator.mode==='walk')$('notice').textContent=navigator.lastBlock||'Walking follows the ground. Buildings block the way.';
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
  // Keep the source building bounds for navigation and map outlines, but do not
  // construct the unrelated legacy box silhouettes in the public scene.
  const visualFallback={...fallback,cells:fallback.cells.map(cell=>({...cell,buildings:[]}))};
  adapter=new ThreeCityAdapter(scene,manifest,visualFallback);
  navigator=new CityNavigator({surface,blocked});
  const b=manifest.coverage.bounds;
  $('coverage').textContent=`${((b[2]-b[0])/1000).toFixed(1)} × ${((b[3]-b[1])/1000).toFixed(1)} km · generated buildings`;
  for(const [id,p] of Object.entries(PLACES))$('place').append(new Option(p.label,id));
  go('above');setLighting('golden');
  if(CITY==='onkyo'){
    const transit=await (await fetch(new URL('../train-route.json',location.href))).json();
    const route=new RailRoute(transit.routes.find(route=>route.id==='loop/inner'));
    journey=new TrainJourney(route,{startStation:'conservatory',cars:9,carLength:20,maxSpeed:22.22,acceleration:.85,dwell:15});
    stockLibrary=await new StockLibrary().load(FLEET.href,{consists:['nyamanote']});
    railway=new RailwayView(scene,transit);trainView=new TrainView(scene,journey,{library:stockLibrary,consist:'nyamanote'});
    $('train-station').replaceChildren(...route.stops.map(s=>new Option(s.name.romaji||s.id,s.id)));
    $('train-station').value='conservatory';
    $('train-panel').hidden=false;trainStatus();
  }
  window.citykit={go,put,ground,centre,setLighting,setFarLayerMode,streamStats:combinedStats,
    cameraPose:()=>({position:[...navigator.position],yaw:navigator.yaw,pitch:navigator.pitch,chaseDistance:chaseLook.distance}),
    streamStatsDetail:()=>({central:city?.stats(),far:farCity?.stats(),terrain:cityTerrain?.stats(),skyline:skyline?.stats()})};
  window.griffin=window.citykit; // Existing local capture harness.
  $('splash').hidden=true;requestAnimationFrame(frame);
  void openFarLayers();
  try{
    ktx=new KTX2Loader().setTranscoderPath(new URL('./basis/',import.meta.url).href).setWorkerLimit(2).detectSupport(renderer);
    const memory=globalThis.navigator.deviceMemory||0,requested=new URLSearchParams(location.search).get('profile');
    const performanceProfile=requested||((memory&&memory<=4)||(navigator.maxTouchPoints>0&&innerWidth<900)?'low':'desktop');
    const low=performanceProfile==='low',mib=1024**2;
    const trainRadii=low?{GROUP:1800,HORIZON:1800,L3:600,L2:250,L1:120}:{GROUP:2500,HORIZON:2500,L3:900,L2:350,L1:180};
    const open=(url,outer=false)=>openBuildingStream({manifestURL:url.href,renderer,scene,camera,ktx2Loader:ktx,
      decoderURL:new URL('./meshopt_decoder.module.js',import.meta.url).href,performanceProfile,tier:'low',
      ...(CITY==='onkyo'?{refineRadii:trainRadii}:{}),
      ...(FAR?{budgetBytes:low?(outer?850:650)*mib:2*1024**3,
        ...(outer?{refineRadii:low?{L1:80,L2:300,L3:900,HORIZON:6000}:
          {L1:150,L2:600,L3:1800,HORIZON:6000}}:
          low?{refineRadii:{L1:80,L2:300,L3:900,HORIZON:1200}}:{})}:{}),
      surfaceAt:(x,y)=>ground(x,y),concurrency:CITY==='onkyo'?6:outer?6:2,uploadBudgetMs:3});
    [city,farCity]=await Promise.all([open(BUILDINGS),FAR?open(FAR,true):Promise.resolve(null)]);
    buildingNodes=new Map(city.manifest.nodes.map(node=>[node.id,node]));
    $('coverage').textContent=CITY==='onkyo'?`${(journey.route.length_m/1000).toFixed(1)} km city loop · ${journey.route.stops.length} stations · textured surroundings`:
      `${((b[2]-b[0])/1000).toFixed(1)} × ${((b[3]-b[1])/1000).toFixed(1)} km · ${city.manifest.source.buildings.toLocaleString('en-US')} generated buildings`;
    setLighting(lighting);
    signAtlas=await loadSignAtlas(THREE,SIGNS.href,{ktx2Loader:ktx});
    city.uniforms.uFcSigns.value=signAtlas;
  }catch(error){console.error(error);$('status').textContent=`Building detail unavailable: ${error.message}`;}
}

$('day').onclick=()=>setLighting('golden');
$('night').onclick=()=>setLighting('night');
$('far-layer').onchange=()=>setFarLayerMode($('far-layer').value);
$('train-start').onclick=startRide;
$('train-outside').onclick=()=>{startRide();journey.time=27;journey.state=journey.evaluate(journey.time);trainView.update();updateTrainCamera();trainStatus();};
$('train-station').onchange=()=>{if(journey){journey.reset($('train-station').value);journey.playing=false;trainView.update();rideCamera='chase';Object.assign(chaseLook,CHASE_DEFAULT);$('train-camera').value='chase';updateTrainCamera();trainStatus();}};
$('train-pause').onclick=()=>{if(journey){journey.playing=!journey.playing;trainStatus();}};
$('train-camera').onchange=()=>{if(rideCamera){rideCamera=$('train-camera').value;updateTrainCamera();}};
$('train-rate').onchange=()=>{rideRate=Number($('train-rate').value);};
$('train-exit').onclick=()=>{rideCamera=null;journey.playing=false;setMode('fly');$('location').textContent='Train stopped · fly camera';};
$('city').onchange=()=>{location.href=`?city=${$('city').value}${new URLSearchParams(location.search).has('profile')?'&profile='+new URLSearchParams(location.search).get('profile'):''}`;};
$('walk').onclick=()=>{setMode('walk');$('view').focus();};
$('fly').onclick=()=>{setMode('fly');$('view').focus();};
$('place').onchange=()=>{go($('place').value);$('view').focus();};
$('panel-toggle').onclick=()=>{const open=$('panel').toggleAttribute('data-open');$('panel-toggle').setAttribute('aria-expanded',open);};
$('view').addEventListener('pointerdown',e=>{$('view').focus();drag=[e.clientX,e.clientY];$('view').setPointerCapture(e.pointerId);});
$('view').addEventListener('pointermove',e=>{if(!drag||!navigator)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];if(rideCamera==='chase'){
  chaseLook.yaw-=dx*.004;chaseLook.pitch=Math.max(-1.2,Math.min(1.2,chaseLook.pitch+dy*.004));
  updateTrainCamera();
}else if(rideCamera){rideLook.yaw-=dx*.0025;rideLook.pitch=Math.max(-1.2,Math.min(1.2,rideLook.pitch-dy*.0025));updateTrainCamera();}
else navigator.look(dx,dy);drag=[e.clientX,e.clientY];});
$('view').addEventListener('pointerup',()=>drag=null);$('view').addEventListener('pointercancel',()=>drag=null);
$('view').addEventListener('wheel',e=>{if(rideCamera!=='chase')return;e.preventDefault();
  const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);
  chaseLook.distance=Math.max(18,Math.min(550,chaseLook.distance*Math.exp(pixels*.0015)));
  updateTrainCamera();
},{passive:false});
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
addEventListener('pagehide',()=>{void city?.close();void farCity?.close();cityTerrain?.close();skyline?.close();trainView?.dispose();stockLibrary?.dispose();ktx?.dispose();signAtlas?.dispose();adapter?.dispose();});
addEventListener('resize',()=>{if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
if(innerWidth<640){$('panel').removeAttribute('data-open');$('panel-toggle').setAttribute('aria-expanded','false');}
main().catch(fail);
