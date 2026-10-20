import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source=await readFile(new URL('../web/js/appearance.js',import.meta.url),'utf8');
function fixture(value, dark=false, blocked=false) {
  const documentEvents={},windowEvents={},systemEvents={},storage=new Map(value?[['swr.appearance',value]]:[]);
  const picker={value:'',matches:s=>s==='[data-theme-picker]'};
  const root={dataset:{}},meta={content:''},system={matches:dark,addEventListener:(n,f)=>systemEvents[n]=f};
  const document={documentElement:root,querySelector:()=>meta,querySelectorAll:()=>[picker],addEventListener:(n,f)=>documentEvents[n]=f};
  const localStorage={getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k)},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v)}};
  runInNewContext(source,{document,localStorage,window:{matchMedia:()=>system,addEventListener:(n,f)=>windowEvents[n]=f}});
  return {root,meta,picker,storage,system,documentEvents,windowEvents,systemEvents};
}
test('day/night apply before DOM readiness, persist and ignore system changes when explicit',()=>{
  const f=fixture('dark',false);assert.equal(f.root.dataset.theme,'dark');assert.equal(f.picker.value,'dark');
  f.picker.value='light';f.documentEvents.change({target:f.picker});
  assert.equal(f.root.dataset.theme,'light');assert.equal(f.storage.get('swr.appearance'),'light');
  f.system.matches=true;f.systemEvents.change();assert.equal(f.root.dataset.theme,'light');
});
test('automatic appearance follows the system and synchronizes across tabs',()=>{
  const f=fixture('auto');assert.equal(f.root.dataset.theme,'light');
  f.system.matches=true;f.systemEvents.change();assert.equal(f.root.dataset.theme,'dark');
  f.windowEvents.storage({key:'swr.appearance',newValue:'light'});assert.equal(f.root.dataset.theme,'light');
  f.windowEvents.storage({key:'swr.appearance',newValue:'invalid'});assert.equal(f.root.dataset.appearance,'auto');assert.equal(f.root.dataset.theme,'dark');
});
test('blocked storage leaves appearance usable and ignores unrelated change events',()=>{
  const f=fixture(null,true,true);assert.equal(f.root.dataset.theme,'dark');
  f.picker.value='light';assert.doesNotThrow(()=>f.documentEvents.change({target:f.picker}));assert.equal(f.root.dataset.theme,'light');
  f.documentEvents.change({target:{matches:()=>false,value:'dark'}});assert.equal(f.root.dataset.theme,'light');
});
