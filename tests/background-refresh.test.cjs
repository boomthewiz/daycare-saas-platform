/* eslint-disable @typescript-eslint/no-require-imports -- Isolated lifecycle harness for delayed RPCs. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const {normalizeCapabilities}=require('./helpers/load-ts.cjs')('lib/effective-capabilities.ts')
const caps={userId:'user-a',organizationId:'org-a',clients:true,users:true,sessions:true,reports:true,reviews:true,billing:true,accessRequests:true,canWrite:true,owner:true,reportingTimezone:null,reportingToday:null}
const progress={branch:true,session_type:true,client:true,staff_ready:false,care:false,scheduled:false,can_write:true,can_clients:true,can_users:true,can_sessions:true,staff:[]}
function mount(file,exportName){
 const values=[],refs=[],requests=[],events={},effects=[];let stateIndex=0,refIndex=0,auth,timer
 const jsx=(type,props)=>({type,props})
 const context={exports:{},JSON,document:{hidden:false,visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn},removeEventListener(){}},clearInterval(){},
  window:{setInterval:fn=>{timer=fn;return 1},setTimeout:fn=>fn(),addEventListener:(name,fn)=>{events[name]=fn},removeEventListener(){}},
  require:name=>name==='react'?{createContext:()=>({Provider:'provider'}),useContext(){},useState:initial=>{const index=stateIndex++;values[index]=initial;return[initial,next=>{values[index]=typeof next==='function'?next(values[index]):next}]},useRef:initial=>{const ref={current:initial};refs[refIndex++]=ref;return ref},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)}
   :name==='react/jsx-runtime'?{jsx,jsxs:jsx}
   :name==='@/lib/effective-capabilities'?{normalizeCapabilities}
   :name==='@/lib/supabase'?{supabase:{rpc:()=>new Promise(resolve=>requests.push(resolve)),auth:{onAuthStateChange:fn=>{auth=fn;return{data:{subscription:{unsubscribe(){}}}}}}}}
   :(()=>{throw new Error(name)})()}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
 const result=context.exports[exportName](exportName==='default'?{children:null}:false)
 const cleanup=effects[0](),flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
 return{values,cleanup,refresh:exportName==='default'?result.props.value.refresh:result.refresh,tick:()=>timer(),event:(name,detail)=>events[name]({detail}),auth:(event,id)=>auth(event,id?{user:{id}}:null),resolve:async(data,error=null)=>{assert.ok(requests.length,'expected pending RPC');requests.shift()({data,error});await flush()},flush}
}
test('unchanged access polls retain verified content and identity; changed grants apply on response',async()=>{
 const h=mount('components/EffectiveCapabilitiesProvider.tsx','default');assert.equal(h.values[1],true)
 await h.resolve(caps);const before=h.values[0];assert.equal(h.values[1],false)
 h.tick();assert.equal(h.values[0],before);assert.equal(h.values[1],false)
 await h.resolve({...caps});assert.equal(h.values[0],before,'unchanged data keeps the same reference')
 h.tick();await h.resolve({...caps,sessions:false});assert.equal(h.values[0].sessions,false)
 h.cleanup()
})
test('failed access refresh clears stale grants and retries use initial-loading state',async()=>{
 const h=mount('components/EffectiveCapabilitiesProvider.tsx','default');await h.resolve(caps)
 h.tick();await h.resolve(null,{message:'denied'});assert.equal(h.values[0],null);assert.ok(h.values[2])
 h.tick();assert.equal(h.values[1],true);await h.resolve(caps);assert.equal(h.values[0].sessions,true);h.cleanup()
})
test('device lock invalidates pending access response',async()=>{
 const h=mount('components/EffectiveCapabilitiesProvider.tsx','default');await h.resolve(caps)
 h.tick();h.event('rejoyce:device-state','locked');assert.equal(h.values[0],null)
 await h.resolve(caps);assert.equal(h.values[0],null,'late response cannot restore locked access');h.cleanup()
})
test('same-user token renewal preserves screen; sign-out and identity change clear it immediately',async()=>{
 const h=mount('components/EffectiveCapabilitiesProvider.tsx','default');await h.resolve(caps);const before=h.values[0]
 h.auth('TOKEN_REFRESHED','user-a');assert.equal(h.values[0],before);await h.resolve(caps)
 h.auth('SIGNED_IN','user-a');assert.equal(h.values[0],before);await h.resolve(caps)
 h.auth('SIGNED_IN','user-b');assert.equal(h.values[0],null);await h.resolve({...caps,userId:'user-b'})
 h.tick();h.auth('SIGNED_OUT');assert.equal(h.values[0],null);await h.resolve({...caps,userId:'user-b'});assert.equal(h.values[0],null);h.cleanup()
})
test('setup polling retains checklist until changed data arrives; errors clear stale readiness',async()=>{
 const h=mount('lib/use-setup-progress.ts','useSetupProgress');await h.resolve(progress);const before=h.values[0]
 h.tick();assert.equal(h.values[0],before);assert.equal(h.values[1],false);await h.resolve({...progress});assert.equal(h.values[0],before)
 h.tick();await h.resolve({...progress,staff_ready:true});assert.equal(h.values[0].staff_ready,true)
 h.tick();await h.resolve(null,{message:'revoked'});assert.equal(h.values[0],null);assert.ok(h.values[2]);h.cleanup()
})
