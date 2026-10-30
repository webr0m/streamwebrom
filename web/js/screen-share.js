import {el} from "./rtc.js";
import {openScreen} from "./devices.js";
import {t} from "./i18n.js";

// Each capture starts from the final click, preserving Chrome's transient user
// activation. Desktop uses its local trusted source picker with the same look.
export function chooseScreen() {
  if(window.StreamWebRomCapture)return openScreen();
  return new Promise((resolve,reject)=>{
    const option=(value,key)=>el('option',{value,text:t(key),"data-i18n":key});
    const surface=el('select',{id:'shareSurface'},option('browser','misc.shareTab'),option('window','misc.shareWindow'),option('monitor','misc.shareScreen'));
    const audio=el('select',{id:'shareAudio'},option('source','misc.shareSourceAudio'),option('none','misc.shareNoAudio'));
    const description=el('p',{class:'muted',id:'shareDescription'});
    const update=()=>{description.dataset.i18n=surface.value==='browser'?'misc.shareHintTab':surface.value==='window'?'misc.shareHintWindow':'misc.shareHintScreen';description.textContent=t(description.dataset.i18n)};
    const download=el('a',{href:'https://github.com/webr0m/streamwebrom/releases/latest',target:'_blank',rel:'noopener',text:t('misc.shareAdvancedPc'),"data-i18n":'misc.shareAdvancedPc'});
    let settled=false,opening=false;
    const dlg=el('dialog',{id:'sharePicker',class:'card devdialog'},el('h3',{text:t('misc.shareTitle'),"data-i18n":'misc.shareTitle'}),el('label',{},t('misc.shareWhat'),surface),el('label',{},t('misc.shareAudioField'),audio),description,download);
    const cancel=el('button',{class:'small',text:t('common.cancel'),"data-i18n":'common.cancel',onclick:()=>dlg.close()});
    const confirm=el('button',{id:'confirmShare',class:'primary',text:t('misc.sharePick'),"data-i18n":'misc.sharePick',onclick:()=>{
      if(opening)return;opening=true;confirm.disabled=true;cancel.disabled=true;
      // Start before closing the dialog so this call retains the user's gesture.
      const capture=openScreen({surface:surface.value,audio:audio.value!=='none'});
      settled=true;dlg.close();dlg.remove();capture.then(resolve,reject);
    }});
    dlg.append(el('div',{class:'row'},cancel,confirm));surface.onchange=update;update();
    dlg.addEventListener('close',()=>{if(!settled){settled=true;reject(Object.assign(new Error(t('misc.shareCancelled')),{name:'AbortError'}))}dlg.remove()},{once:true});
    document.body.append(dlg);dlg.showModal();
  });
}
