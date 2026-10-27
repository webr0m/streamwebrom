let type='window',state={sources:[],nativeAudio:false},busy=false;
const $=s=>document.querySelector(s);
function render(){
  document.documentElement.dataset.theme=state.theme||'dark';
  $('#contentForm').classList.toggle('hidden',type!=='browser');
  document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('primary',b.dataset.type===type));
  const audio=$('#audio');
  const allowed=type==='browser'?['tab','none']:type==='window'?['application','system','none']:['system','none'];
  const labels={tab:'Solo esta pestaña',application:'Solo la aplicación elegida',system:'Sistema sin las voces de la sala',none:'Sin audio'};
  const previous=audio.value;audio.replaceChildren();
  for(const mode of allowed){const o=document.createElement('option');o.value=mode;o.textContent=labels[mode];o.disabled=mode!=='none'&&mode!=='tab'&&!state.nativeAudio;audio.append(o)}
  audio.value=allowed.includes(previous)?previous:allowed[0];if(audio.selectedOptions[0]?.disabled)audio.value='none';
  $('#availability').textContent=type==='window'?'El sonido pertenece a la aplicación; varias ventanas del mismo programa pueden compartir audio.':type==='browser'?'La pestaña se captura con su sonido aislado.':'Se excluye el proceso de StreamWebRom y sus procesos de audio.';
  if(!state.nativeAudio&&type!=='browser')$('#availability').textContent+=' La captura nativa de audio no está disponible en este equipo.';
  $('#sources').replaceChildren();
  for(const source of state.sources.filter(s=>s.kind===type)){
    const b=document.createElement('button');b.className='capture-source';b.dataset.source=source.id;
    if(source.thumbnail){const img=document.createElement('img');img.src=source.thumbnail;img.alt='';b.append(img)}
    const label=document.createElement('span');label.textContent=source.name;b.append(label);
    b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;$('#error').textContent='';try{await window.capturePicker.choose(source.id,audio.value)}catch(e){$('#error').textContent=e.message;busy=false;b.disabled=false}};
    $('#sources').append(b);
  }
  if(!$('#sources').children.length){const p=document.createElement('p');p.className='muted';p.textContent=type==='browser'?'Abre una pestaña de contenido y luego pulsa Actualizar.':'No hay fuentes disponibles. Pulsa Actualizar.';$('#sources').append(p)}
}
async function load(){try{state=await window.capturePicker.load();render()}catch(e){$('#error').textContent=e.message}}
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;render()});
$('#refresh').onclick=load;$('#cancel').onclick=()=>window.capturePicker.cancel();
$('#openContent').onclick=async()=>{try{await window.capturePicker.content($('#contentURL').value.trim());await load()}catch(e){$('#error').textContent=e.message}};
window.addEventListener('keydown',e=>{if(e.key==='Escape')window.capturePicker.cancel()});
load();
