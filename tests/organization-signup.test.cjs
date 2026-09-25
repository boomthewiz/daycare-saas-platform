const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')

function load(options={}) {
 const calls=[]
 const filename=path.resolve(__dirname,'../app/api/organization-signup/route.ts')
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths
 mod.require=name=>name==='@/lib/device-session-server'?{
  privateHeaders:{'Cache-Control':'private, no-store'},
  verifiedIdentity:async()=>options.noIdentity?null:{user:{id:'verified-user'},sessionId:'verified-session'},
  deviceState:async()=>options.state||{state:'setup',canSetPin:true}
 }:name==='@/lib/supabase-admin'?{supabaseAdmin:{rpc:async(name,args)=>{
  calls.push([name,args]);return name==='reserve_pin_login_attempt'?{data:[{allowed:options.allowed!==false}],error:options.limitError||null}:{data:'created-org',error:options.createError||null}
 }}}:name==='@supabase/supabase-js'?{createClient:()=>({auth:{signInWithOtp:async(args)=>{calls.push(['send',args]);return {error:options.sendError||null}}}})}:require(name)
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename)
 async function invoke(action){
  const previous=process.env.SELF_SERVICE_SIGNUP_ENABLED
  if(options.enabled===null)delete process.env.SELF_SERVICE_SIGNUP_ENABLED
  else process.env.SELF_SERVICE_SIGNUP_ENABLED=options.enabled??'true'
  try{return await action()}finally{
   if(previous===undefined)delete process.env.SELF_SERVICE_SIGNUP_ENABLED
   else process.env.SELF_SERVICE_SIGNUP_ENABLED=previous
  }
 }
 return {calls,get:()=>invoke(()=>mod.exports.GET()),post:body=>invoke(()=>mod.exports.POST(new Request('https://www.rejoyceapp.com/api/organization-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})))}
}
const create={action:'create',name:'Organization',fullName:'Owner',branchName:'Main',organizationType:'Other'}
test('signup defaults closed and rejects both email and creation without side effects',async()=>{
 for(const enabled of [null,'false','TRUE','1']){
  const h=load({enabled})
  const availability=await h.get()
  assert.equal((await availability.json()).enabled,false)
  assert.match(availability.headers.get('Cache-Control'),/no-store/)
  assert.equal((await h.post({action:'send',email:'synthetic@example.invalid'})).status,503)
  assert.equal((await h.post(create)).status,503)
  assert.deepEqual(h.calls,[])
 }
 assert.equal((await (await load().get()).json()).enabled,true)
})
test('signup validates and rate-limits before requesting an email',async()=>{
 const bad=load();assert.equal((await bad.post({action:'send',email:'invalid'})).status,400);assert.equal(bad.calls.length,0)
 for(const options of [{allowed:false},{limitError:{message:'offline'}}]){
  const h=load(options);assert.ok([429,503].includes((await h.post({action:'send',email:'synthetic@example.invalid'})).status));assert.equal(h.calls.some(c=>c[0]==='send'),false)
 }
 const h=load();assert.equal((await h.post({action:'send',email:' Synthetic@Example.invalid '})).status,200)
 assert.equal(h.calls[1][1].email,'synthetic@example.invalid');assert.equal(h.calls[1][1].options.shouldCreateUser,true)
})
test('creation uses verified identity and ignores supplied ownership or trial claims',async()=>{
 const h=load();const response=await h.post({...create,userId:'attacker',organizationId:'foreign',trialDays:365,role:'admin'})
 assert.equal(response.status,200);assert.equal((await response.json()).destination,'/set-pin')
 assert.deepEqual(h.calls[0],[ 'create_self_service_organization', {p_user_id:'verified-user',p_session_id:'verified-session',p_name:'Organization',p_full_name:'Owner',p_branch_name:'Main',p_organization_type:'Other'} ])
})
test('locked or unverified devices cannot bootstrap an organization',async()=>{
 for(const options of [{noIdentity:true},{state:{state:'locked',canSetPin:true}},{state:{state:'setup',canSetPin:false}}]){
  const h=load(options);assert.equal((await h.post(create)).status,401);assert.equal(h.calls.length,0)
 }
})
test('membership conflicts and failed creation never claim success',async()=>{
 assert.equal((await load({createError:{code:'23505'}}).post(create)).status,409)
 const response=await load({createError:{code:'offline'}}).post(create)
 assert.equal(response.status,503);assert.match((await response.json()).error,/information is still here/)
 const h=load();assert.equal((await h.post({...create,name:''})).status,400);assert.equal(h.calls.length,0)
})
