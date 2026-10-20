import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleURL } from './module-url.mjs';
const {vdoLinks,parseVdoView,newVdoLinks,newVdoRoom,vdoRoomLinks,vdoHostPath}=await import(await moduleURL('vdo.js'));
test('VDO interoperability stays on the official application and strips executable/custom relay options',()=>{
  const links=parseVdoView('https://vdo.ninja/?view=sample123&password=private&turn=unwanted&javascript=unwanted');
  const u=new URL(links.viewer);assert.equal(u.origin,'https://vdo.ninja');assert.equal(new URLSearchParams(u.hash.slice(1)).get('p'),'private');assert.equal(u.searchParams.has('password'),false);
  assert.equal(u.searchParams.has('turn'),false);assert.equal(u.searchParams.has('javascript'),false);
  for(const value of ['javascript:alert(1)','http://vdo.ninja/?view=sample123','https://vdo.ninja.evil.test/?view=sample123','https://vdo.ninja@evil.test/?view=sample123','https://vdo.ninja/iframe?view=sample123','https://vdo.ninja/?push=sample123'])assert.throws(()=>parseVdoView(value));
});
test('VDO invitations use independent unpredictable credentials and preserve publisher/view pairing',()=>{
  const a=newVdoLinks(),b=newVdoLinks(),p=new URL(a.publisher),v=new URL(a.viewer);
  assert.equal(p.searchParams.get('push'),v.searchParams.get('view'));
  assert.match(v.searchParams.get('view'),/^[a-f0-9]{32}$/);
  assert.notEqual(a.viewer,b.viewer);assert.notEqual(new URLSearchParams(v.hash.slice(1)).get('p'),p.searchParams.get('push'));
  assert.throws(()=>vdoLinks('short'));
});
test('independent VDO rooms separate director credentials from guest/OBS links and hide passwords from requests',()=>{
  const a=newVdoRoom('myshow','guestPassword','Program'),b=newVdoRoom('myshow','guestPassword','Program');
  assert.notEqual(a.room,b.room);assert.notEqual(a.password,a.directorKey);
  const links=vdoRoomLinks(a);
  for(const role of ['host','guest','scene']){const u=new URL(links[role]);assert.equal(u.origin,'https://vdo.ninja');assert.equal(u.searchParams.has('password'),false);assert.equal(new URLSearchParams(u.hash.slice(1)).get('p'),'guestPassword');}
  assert.equal(new URLSearchParams(new URL(links.guest).hash.slice(1)).has('codirector'),false);
  assert.equal(new URL(links.scene).searchParams.get('scene'),'1');
  assert.ok(vdoHostPath(a).includes('#'));assert.throws(()=>newVdoRoom('myshow','bad password'));
});
