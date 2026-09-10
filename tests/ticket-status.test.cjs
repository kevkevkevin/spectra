const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const order='31a9cb6f-4e01-4cc0-a201-5d85f97a6802';
const plain=value=>JSON.parse(JSON.stringify(value));
const ticket={id:'1be687c7-c880-417d-a96d-584eb805a6b4',order_id:order,seat_number:1,checked_in_at:'2026-09-09T18:00:00.000Z',food_redeemed_at:null};

function harness({signedIn=true,dbError=null,rows=[ticket]}={}){
 const calls=[];
 const chain={
  select(fields){calls.push(['select',fields]);return chain;},
  in(column,ids){calls.push(['in',column,plain(ids)]);return chain;},
  order(column){calls.push(['order',column]);return chain;},
  async limit(amount){calls.push(['limit',amount]);return {data:rows,error:dbError};},
 };
 const db={auth:{async getUser(){calls.push(['getUser']);return {data:{user:signedIn?{id:'guest'}:null},error:null};}},from(table){calls.push(['from',table]);return chain;}};
 const imports={
  'next/server':{NextResponse:{json(body,options={}){return {body:plain(body),status:options.status??200,headers:plain(options.headers??{})};}}},
  '@/lib/supabase/server':{async createClient(){calls.push(['createClient']);return db;}},
  '@/lib/tickets':{UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i},
 };
 const source=fs.readFileSync(path.join(__dirname,'../app/api/tickets/status/route.ts'),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const module={exports:{}};
 const context=vm.createContext({module,exports:module.exports,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
 new vm.Script(outputText).runInContext(context);
 return {calls,request(value=order){return module.exports.GET({nextUrl:new URL(`https://spectra.test/api/tickets/status?orders=${encodeURIComponent(value)}`)});}};
}

test('ticket activity rejects missing, malformed, and over-limit booking filters before querying',async()=>{
 for(const value of ['',`${order},bad-id`,Array(101).fill(order).join(',')]){
  const app=harness();
  const response=await app.request(value);
  assert.equal(response.status,400);
  assert.deepEqual(app.calls,[]);
 }
});

test('ticket activity requires a verified signed-in user before accessing tickets',async()=>{
 const app=harness({signedIn:false});
 const response=await app.request();
 assert.equal(response.status,401);
 assert.deepEqual(app.calls,[['createClient'],['getUser']]);
 assert.match(response.headers['Cache-Control'],/private.*no-store/);
});

test('ticket activity returns only scan fields and uses the signed-in RLS client',async()=>{
 const app=harness({rows:[{...ticket,token:'secret-qr',customer_email:'private@example.test',receipt_path:'private/receipt.png'}]});
 const response=await app.request(`${order},${order}`);
 assert.equal(response.status,200);
 assert.deepEqual(response.body,{tickets:[ticket]});
 assert.equal(response.headers['Vary'],'Cookie');
 assert.match(response.headers['Cache-Control'],/private.*no-store/);
 assert.deepEqual(app.calls,[['createClient'],['getUser'],['from','issued_tickets'],['select','id,order_id,seat_number,checked_in_at,food_redeemed_at'],['in','order_id',[order]],['order','seat_number'],['limit',1000]]);
});

test('an RLS-filtered empty result does not fabricate ticket activity',async()=>{
 const app=harness({rows:[]});
 const response=await app.request();
 assert.equal(response.status,200);
 assert.deepEqual(response.body,{tickets:[]});
});

test('missing scanner migration returns an explicit setup error without a success payload',async()=>{
 const app=harness({dbError:{code:'42703',message:'column issued_tickets.food_redeemed_at does not exist'}});
 const response=await app.request();
 assert.equal(response.status,503);
 assert.equal(response.body.code,'SCAN_SETUP_REQUIRED');
 assert.equal(response.body.tickets,undefined);
 assert.equal(response.body.error.includes('issued_tickets'),false);
});

test('database failures do not reveal internal errors or claim successful scans',async()=>{
 const app=harness({dbError:{code:'XX000',message:'internal database credentials or query details'}});
 const response=await app.request();
 assert.equal(response.status,503);
 assert.equal(response.body.code,'STATUS_UNAVAILABLE');
 assert.equal(response.body.tickets,undefined);
 assert.equal(JSON.stringify(response.body).includes('credentials'),false);
});
