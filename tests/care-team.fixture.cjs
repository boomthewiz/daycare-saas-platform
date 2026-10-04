// Loopback-only browser fixture. Every care RPC runs against isolated PostgreSQL,
// with the actual migration, authenticated role, RLS and synthetic device session.
// Requires REJOYCE_BASELINE_SQL and REJOYCE_PGLITE_MODULE. Start built Next on
// 3027 with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3029 and synthetic keys.
const http = require('node:http')
const { loadCareDatabase, applyCareMigration } = require('./helpers/care-db.cjs')
const owner = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222'
const north = '33333333-3333-4333-8333-333333333333', south = '44444444-4444-4444-8444-444444444444'
const a = '55555555-5555-4555-8555-555555555555', b = '66666666-6666-4666-8666-666666666666', c = '77777777-7777-4777-8777-777777777777'
const sessionId = '88888888-8888-4888-8888-888888888888'
const user = {id:owner,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner,session_id:sessionId,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.synthetic'
const auth = {access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,expires_in:36000,token_type:'bearer',user}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'});res.end(JSON.stringify(data))}
const rpcArgs = {
  care_context:['p_client_id'], save_staff_locations:['p_user_id','p_location_ids','p_expected_ids'],
  save_care_group:['p_id','p_name','p_kind','p_location_id','p_member_ids','p_expected_version'],
  set_client_care_team:['p_client_id','p_member_ids','p_primary_id','p_expected_version'],
  create_client_with_care_team:['p_first_name','p_last_name','p_preferred_name','p_location_ids','p_member_ids','p_primary_id'],
  set_client_locations:['p_client_id','p_location_ids'],
}
;(async()=>{
 const db = await loadCareDatabase(); await applyCareMigration(db)
 await db.exec(`INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic ReJoyce');
  INSERT INTO auth.users(id,email) VALUES('${owner}','synthetic@example.invalid');
  INSERT INTO public.users(id,organization_id,full_name,role,status,pin_hash,pin_reset_required) VALUES
  ('${owner}','${org}','Synthetic owner','owner','active','synthetic',false),
  ('${a}','${org}','Alex Care','teacher','active','synthetic',false),
  ('${b}','${org}','Blair Care','teacher','active','synthetic',false),
  ('${c}','${org}','Casey Care','aide','active','synthetic',false);
  INSERT INTO auth.sessions(id,user_id) VALUES('${sessionId}','${owner}');
  INSERT INTO public.device_sessions VALUES('${sessionId}','${owner}',now(),now(),now()+interval '1 day',false);
  INSERT INTO public.organization_locations(id,organization_id,name) VALUES('${north}','${org}','North'),('${south}','${org}','South');
  SELECT set_config('request.jwt.claim.sub','${owner}',false);
  SELECT set_config('request.jwt.claims','${JSON.stringify({sub:owner,session_id:sessionId,role:'authenticated'})}',false);
  SET ROLE authenticated;
  SELECT public.save_staff_locations('${a}',ARRAY['${north}']::uuid[],'{}');
  SELECT public.save_staff_locations('${b}',ARRAY['${north}','${south}']::uuid[],'{}');
  SELECT public.save_staff_locations('${c}',ARRAY['${north}']::uuid[],'{}');
  SELECT public.save_care_group(NULL,'Sunshine Class','class','${north}',ARRAY['${a}','${b}']::uuid[],NULL);
  SELECT public.save_care_group(NULL,'Care Team','team','${north}',ARRAY['${b}','${c}']::uuid[],NULL);`)
 let writes=[], fail=false, denied=false, readonly=false, conflict=false, queue=Promise.resolve()
 const query = async(sql,args=[]) => (await db.query(sql,args)).rows
 http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,null)
  const url=new URL(req.url,'http://127.0.0.1:3029'), pathname=url.pathname
  let body=''; for await(const chunk of req)body+=chunk
  queue=queue.then(async()=>{
   try {
    if(pathname==='/control') {
      const mode=url.searchParams.get('mode')
      if(mode==='fail')fail=true
      if(mode==='denied')denied=true
      if(mode==='readonly')readonly=true
      if(mode==='conflict')conflict=true
      if(mode==='normal'){denied=false;readonly=false;fail=false;conflict=false}
      return json(res,{writes,clients:await query('SELECT id,first_name,assigned_provider_id,care_team_version FROM public.clients'),assignments:await query('SELECT client_id,user_id FROM public.client_care_members')})
    }
    if(pathname==='/auth/v1/user')return json(res,user)
    if(pathname.includes('/rpc/')) {
      const name=pathname.split('/').pop(), args=body?JSON.parse(body):{}
      if(name==='subscription_access')return json(res,{managed:false,canWrite:!readonly,canFinishSession:true,serverNow:new Date().toISOString()})
      if(name==='can_manage_clients')return json(res,!denied)
      if(name==='current_organization_id')return json(res,org)
      if(rpcArgs[name]) {
        if(name!=='care_context') {
          writes.push({name,args})
          if(fail){fail=false;return json(res,{message:'Synthetic connection interruption — try again',code:'FIXTURE'},503)}
          if(denied||readonly)return json(res,{message:'Editing permission unavailable',code:'42501'},403)
          if(conflict && name==='set_client_care_team')return json(res,{message:'Care team changed. Reload before saving.',code:'40001'},409)
        }
        const keys=rpcArgs[name], rows=await query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,keys.map(key=>args[key]??null))
        return json(res,rows[0].value)
      }
      if(['can_manage_users','can_manage_sessions'].includes(name))return json(res,(await query(`SELECT public.${name}() value`))[0].value)
      return json(res,false)
    }
    const table=pathname.split('/').pop(), singular=(req.headers.accept||'').includes('vnd.pgrst.object')
    let data=[]
    if(table==='users')data=await query('SELECT id,organization_id,full_name,email,role,status FROM public.users')
    if(table==='user_permissions')data=[{user_id:owner,organization_id:org,can_manage_clients:!denied,can_manage_users:true,can_manage_sessions:true,can_review_sessions:true,can_view_reports:true,can_manage_billing:true}]
    if(table==='organizations')data=await query('SELECT id,name,organization_type FROM public.organizations')
    if(table==='organization_locations')data=await query('SELECT id,name,active,sort_order FROM public.organization_locations ORDER BY name')
    if(table==='client_locations')data=await query('SELECT client_id,location_id FROM public.client_locations')
    if(table==='clients'){
      if(req.method==='PATCH'){
        const fields=JSON.parse(body),cid=url.searchParams.get('id')?.slice(3)
        const keys=Object.keys(fields)
        if(keys.some(key=>!['first_name','last_name','preferred_name','status'].includes(key)))throw Error('Fixture rejects unsafe profile update')
        await query(`UPDATE public.clients SET ${keys.map((key,i)=>key+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1}`, [...keys.map(key=>fields[key]),cid])
        return json(res,null)
      }
      data=await query(`SELECT c.*,coalesce((SELECT jsonb_agg(jsonb_build_object('location_id',cl.location_id)) FROM public.client_locations cl WHERE cl.client_id=c.id),'[]') client_locations FROM public.clients c ORDER BY created_at DESC`)
    }
    for(const key of ['id','client_id']){ const filter=url.searchParams.get(key); if(filter?.startsWith('eq.'))data=data.filter(row=>row[key]===filter.slice(3)) }
    json(res,singular?data[0]||null:data)
   } catch(cause){json(res,{message:cause.message,code:cause.code||'FIXTURE'},400)}
  }).catch(cause=>{console.error(cause.message);json(res,{message:'Fixture error'},500)})
 }).listen(3029,'127.0.0.1')
 http.createServer((req,res)=>{
  if(req.url==='/start'){
   res.writeHead(200,{'Content-Type':'text/html'});res.end(`<h1>Synthetic care-team acceptance</h1><p>Isolated PostgreSQL. No production connections.</p><button onclick='localStorage.setItem("sb-127-auth-token",${JSON.stringify(JSON.stringify(auth))});location.href="/team-management"'>Start synthetic clients</button>`);return
  }
  if(req.url.startsWith('/api/session-policy'))return json(res,{enabled:false})
  if(req.url.startsWith('/api/pin-status'))return json(res,{hasPin:true,resetRequired:false})
  const proxy=http.request({hostname:'127.0.0.1',port:3027,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3027'}},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)})
  proxy.on('error',()=>json(res,{message:'Start local Next on 3027'},502));req.pipe(proxy)
 }).listen(3028,'127.0.0.1')
 console.log('Care-team PostgreSQL fixture: http://127.0.0.1:3028/start; control 3029/control. No production data.')
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await db.close();process.exit()})
})().catch(cause=>{console.error(cause.message);process.exit(1)})
