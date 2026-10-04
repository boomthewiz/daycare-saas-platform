// Synthetic HTTP backend and reverse proxy for manual browser acceptance.
// Bind only to loopback. This never connects to Supabase or production.
// Start Next on 3017 with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3019
// and NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-anon-key, then open /start
// on the proxy at 3018. Control cases with GET 3019/control?mode=... .
const http = require('node:http')
const sessionId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const org = '33333333-3333-4333-8333-333333333333'
const stamp = '2026-10-03T15:00:00.000Z'
const user = {id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
let session, writes=[], fail=false, canManage=true, writeAccess=true, unavailable=false
function reset(status='scheduled') {
 session={id:sessionId,organization_id:org,client_id:sessionId,provider_id:userId,supervisor_id:null,session_type:'direct_therapy',status,attendance_status:'unconfirmed',scheduled_start:stamp,scheduled_end:'2026-10-03T16:00:00.000Z',started_at:status==='in_progress'?stamp:null,paused_at:null,completed_at:null,total_paused_seconds:0,location:'Synthetic room',was_supervised:false,prepared_by:null,prepared_at:null,created_at:stamp,updated_at:stamp}
 writes=[];fail=false;canManage=true;writeAccess=true;unavailable=false
}
reset()
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'});res.end(JSON.stringify(data))}
http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS')return json(res,null)
 const url=new URL(req.url,'http://127.0.0.1:3019'),path=url.pathname
 if(path==='/control'){
  const mode=url.searchParams.get('mode');
  if(mode==='reset')reset();if(mode==='started')reset('in_progress');if(mode==='historical')reset('completed')
  if(mode==='fail')fail=true;if(mode==='denied')canManage=false;if(mode==='readonly')writeAccess=false;if(mode==='missing')unavailable=true
  if(mode==='conflict')session.updated_at=new Date().toISOString()
  return json(res,{session,writes,canManage,writeAccess})
 }
 let body='';for await(const chunk of req)body+=chunk
 let data=[]
 if(path==='/auth/v1/user')data=user
 else if(path.endsWith('/rpc/can_manage_sessions'))data=canManage
 else if(path.endsWith('/rpc/current_organization_id'))data=org
 else if(path.endsWith('/rpc/subscription_access'))data={managed:false,canWrite:writeAccess,canFinishSession:true,serverNow:new Date().toISOString()}
 else if(path.endsWith('/users')){
  const row={id:userId,organization_id:org,role:'owner',status:'active',full_name:'Synthetic owner',email:user.email}
  data=url.searchParams.has('id')?row:[{...row,role:'teacher'}]
 }
 else if(path.endsWith('/user_permissions'))data={can_manage_sessions:canManage}
 else if(path.endsWith('/session_types'))data=[{id:sessionId,organization_id:org,name:'Direct service',code:'direct_therapy',active:true,sort_order:0,default_duration_minutes:60}]
 else if(path.endsWith('/clients')){const client={id:sessionId,first_name:'Synthetic client',last_name:null,preferred_name:null,status:'active',assigned_provider_id:userId};data=url.searchParams.has('id')?client:[client]}
 else if(path.endsWith('/session_notes'))data=null
 else if(path.endsWith('/sessions')){
  if(req.method==='PATCH'){
   writes.push({query:Object.fromEntries(url.searchParams),body:JSON.parse(body)})
   if(fail){fail=false;return json(res,{message:'Synthetic connection interruption'},503)}
   if(!canManage||!writeAccess)return json(res,{message:'Editing permission denied',code:'42501'},403)
   if(url.searchParams.get('id')!==`eq.${sessionId}`||url.searchParams.get('organization_id')!==`eq.${org}`)return json(res,{message:'Wrong record or organization'},400)
   if(url.searchParams.get('updated_at')!==`eq.${session.updated_at}`)return json(res,{message:'No rows',code:'PGRST116'},406)
   session={...session,...JSON.parse(body),updated_at:new Date().toISOString()};data={id:sessionId}
  }else if(unavailable)return json(res,{message:'Session not found',code:'PGRST116'},406)
  else data=url.searchParams.has('id')?session:[{...session,clients:{first_name:'Synthetic client',preferred_name:null},provider:{full_name:'Synthetic teacher',email:user.email},session_targets:[]}]
 }
 json(res,data)
}).listen(3019,'127.0.0.1')
const proxyServer=http.createServer((req,res)=>{
 if(req.url==='/start'){
  res.writeHead(200,{'Content-Type':'text/html'});res.end(`<h1>Synthetic session editor acceptance</h1><p>No production data is used.</p><button onclick='localStorage.setItem("sb-127-auth-token",${JSON.stringify(JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,expires_in:36000,token_type:'bearer',user}))});location.href="/sessions"'>Start synthetic sessions</button>`);return
 }
 if(req.url.startsWith('/api/session-policy'))return json(res,{enabled:false})
 if(req.url.startsWith('/api/pin-status'))return json(res,{hasPin:true,resetRequired:false})
 const proxy=http.request({hostname:'127.0.0.1',port:3017,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3017'}},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)})
 proxy.on('error',()=>json(res,{error:'Start local Next server on 3017'},502));req.pipe(proxy)
})
proxyServer.on('upgrade',(req,socket,head)=>{
 const upstream=require('node:net').connect(3017,'127.0.0.1',()=>{
  upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
  if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)
 });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy())
})
proxyServer.listen(3018,'127.0.0.1')
console.log('Synthetic acceptance at http://127.0.0.1:3018/start; control API 3019. No production connections.')
