import {el} from "./rtc.js";
import {openScreen} from "./devices.js";

// Each capture starts from the final click, preserving Chrome's transient user
// activation. Desktop uses its local trusted source picker with the same look.
export function chooseScreen() {
  if(window.StreamWebRomCapture)return openScreen();
  return new Promise((resolve,reject)=>{
    const surface=el('select',{id:'shareSurface'},el('option',{value:'browser',text:'Pestaña'}),el('option',{value:'window',text:'Ventana'}),el('option',{value:'monitor',text:'Pantalla completa'}));
    const audio=el('select',{id:'shareAudio'},el('option',{value:'source',text:'Compartir audio de la fuente'}),el('option',{value:'none',text:'Sin audio'}));
    const description=el('p',{class:'muted',id:'shareDescription'});
    const update=()=>{description.textContent=surface.value==='browser'?'Marca Compartir audio de la pestaña en el selector del navegador.':surface.value==='window'?'Se solicitará el audio de la ventana. Para aislar cualquier aplicación también puedes usar Captura avanzada en PC.':'Se solicitará audio del sistema con exclusión del sonido de esta sala. La captura avanzada para PC permite excluir la llamada por proceso.'};
    const download=el('a',{href:'https://github.com/webr0m/streamwebrom/releases/latest',target:'_blank',rel:'noopener',text:'Captura avanzada para PC'});
    let settled=false,opening=false;
    const dlg=el('dialog',{id:'sharePicker',class:'card devdialog'},el('h3',{text:'Compartir contenido'}),el('label',{},'Qué compartir',surface),el('label',{},'Audio',audio),description,download);
    const cancel=el('button',{class:'small',text:'Cancelar',onclick:()=>dlg.close()});
    const confirm=el('button',{id:'confirmShare',class:'primary',text:'Elegir fuente',onclick:()=>{
      if(opening)return;opening=true;confirm.disabled=true;cancel.disabled=true;
      // Start before closing the dialog so this call retains the user's gesture.
      const capture=openScreen({surface:surface.value,audio:audio.value!=='none'});
      settled=true;dlg.close();dlg.remove();capture.then(resolve,reject);
    }});
    dlg.append(el('div',{class:'row'},cancel,confirm));surface.onchange=update;update();
    dlg.addEventListener('close',()=>{if(!settled){settled=true;reject(Object.assign(new Error('Captura cancelada'),{name:'AbortError'}))}dlg.remove()},{once:true});
    document.body.append(dlg);dlg.showModal();
  });
}
