const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function fixture() {
  const sid = 'abcdefghijklmnopqrst';
  const doc = {name:'stones/'+sid,updateTime:'0',fields:{}};
  const set = (k,v) => doc.fields[k] = {stringValue:v};
  Object.entries({shopState:'available',name:'L10',shopPreview:'data:image/jpeg;base64,AQ=='}).forEach(([k,v]) => set(k,v));
  const payments=new Map();
  const context={require,Buffer,process:{env:{}},module:{exports:{}},fetch:async (url,opts) => {
    if (opts?.method === 'POST') {
      const request=JSON.parse(opts.body), key=opts.headers['Idempotence-Key'];
      if (!payments.has(key)) payments.set(key,{id:'pay'+payments.size,status:'pending',amount:request.amount,
        metadata:request.metadata,confirmation:{confirmation_url:'https://example.test/pay'}});
      return {ok:true,json:async()=>payments.get(key)};
    }
    return {ok:true,json:async()=>[...payments.values()].find(x=>url.endsWith(x.id))};
  },mockFs:async(method,path,body)=>{
    if (method === 'GET') return structuredClone(doc);
    const [write]=body.writes;
    if (write.currentDocument.updateTime !== doc.updateTime) throw Error('concurrent modification');
    Object.assign(doc.fields,write.update.fields);
    doc.updateTime=String(Number(doc.updateTime)+1);
  }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./shop-function.js'),'utf8')+'\nfs=mockFs;',context);
  const order={id:'catalog-stone',sid,mode:'love',attempt:crypto.randomUUID(),name:'Тест',phone:'000',
    email:'test@example.org',delivery:'cdek',address:'ПВЗ',termsAccepted:'1'};
  return {context,order,doc,payments};
}

for(const [mode,price] of Object.entries({love:2900,luna:3500,tal:4200,path:5500})){
  test(mode+' uses the approved price, reserves the whole stone and applies the paid mode once', async()=>{
    const {context,order,doc,payments}=fixture();order.mode=mode;
    const [first,other]=await Promise.all([context.pay(order),context.pay({...order,attempt:crypto.randomUUID(),mode:'path'})]);
    assert.equal(first[0],200);assert.equal(other[0],409);
    assert.equal((await context.pay(order))[0],200);
    assert.equal(payments.size,1);const [payment]=payments.values();
    assert.equal(payment.amount.value,price+'.00');assert.equal(doc.fields.shopState.stringValue,'reserved');
    payment.status='succeeded';
    await context.webhook({event:'payment.succeeded',object:{id:payment.id}});
    const version=doc.updateTime;
    await context.webhook({event:'payment.succeeded',object:{id:payment.id}});
    assert.equal(doc.updateTime,version);
    assert.equal(doc.fields.shopState.stringValue,'sold');
    assert.equal(doc.fields.buy.stringValue,mode);assert.equal((await context.pay(order))[0],409);
  });
}
test('only the verified current cancellation releases the physical stone',async()=>{
  const {context,order,doc,payments}=fixture();await context.pay(order);
  const [payment]=payments.values();
  await context.webhook({event:'payment.canceled',object:{id:payment.id}});
  assert.equal(doc.fields.shopState.stringValue,'reserved');
  payment.status='canceled'; await context.webhook({event:'payment.canceled',object:{id:payment.id}});
  assert.equal(doc.fields.shopState.stringValue,'available');
  assert.equal((await context.pay({...order,attempt:crypto.randomUUID()}))[0],200);
  await context.webhook({event:'payment.canceled',object:{id:payment.id}});
  assert.equal(doc.fields.shopState.stringValue,'reserved');
});
