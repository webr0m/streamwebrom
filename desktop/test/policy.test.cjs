const {test}=require('node:test');const assert=require('node:assert/strict');
const {serverURL,trustedFrame,audioPlan,CaptureLease}=require('../policy.cjs');
test('native capabilities accept explicit HTTPS or local development only',()=>{
  for(const url of ['https://stream.webrom.cc/guest?room=a#invite=secret','http://127.0.0.1:18443','http://localhost:1234'])assert.ok(serverURL(url));
  for(const url of ['file:///C:/secret','javascript:alert(1)','https://user:pass@stream.webrom.cc','http://192.168.1.4','https://good.test\\@bad.test'])assert.throws(()=>serverURL(url));
});
test('foreign pages, iframes and destroyed windows cannot call the native bridge',()=>{
  const frame={url:'https://studio.test/guest'},wc={mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url};
  assert.equal(trustedFrame({sender:wc,senderFrame:frame},wc,'https://studio.test'),true);
  assert.equal(trustedFrame({sender:wc,senderFrame:{url:frame.url}},wc,'https://studio.test'),false);
  assert.equal(trustedFrame({sender:wc,senderFrame:frame},wc,'https://evil.test'),false);
  wc.isDestroyed=()=>true;assert.equal(trustedFrame({sender:wc,senderFrame:frame},wc,'https://studio.test'),false);
});
test('window capture includes only the selected app; system capture excludes the whole call tree',()=>{
  assert.deepEqual(audioPlan({kind:'window',pid:700},'application',500),{mode:'native',pid:700,include:true});
  assert.deepEqual(audioPlan({kind:'screen'},'system',500),{mode:'native',pid:500,include:false});
  assert.deepEqual(audioPlan({kind:'window',pid:700},'system',500),{mode:'native',pid:500,include:false});
  assert.throws(()=>audioPlan({kind:'window',pid:500},'application',500));
  assert.throws(()=>audioPlan({kind:'window',pid:0},'application',500));
  assert.throws(()=>audioPlan({kind:'screen',own:true},'system',500));
});
test('tab capture grants only its selected web frame; no-audio never starts native capture',()=>{
  const frame={};assert.deepEqual(audioPlan({kind:'browser',frame},'tab',500),{mode:'tab',frame});
  assert.deepEqual(audioPlan({kind:'screen'},'none',500),{mode:'none'});
});
test('old capture cleanup cannot stop a replacement session and teardown is idempotent',()=>{
  let stops=0;const leases=new CaptureLease(()=>stops++),old=leases.create({});old.started=true;
  const fresh=leases.create({});fresh.started=true;assert.equal(stops,1);
  assert.equal(leases.clear(old.id),false);assert.equal(leases.get(fresh.id),fresh);assert.equal(stops,1);
  leases.clear(fresh.id);leases.clear();assert.equal(stops,2);assert.equal(leases.current,null);
});
