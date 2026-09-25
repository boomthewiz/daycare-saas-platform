// Local acceptance tests: every email, auth and database response is synthetic.
const {chromium}=require('playwright')
const assert=require('node:assert/strict')
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3017'
const user={id:'22222222-2222-4222-8222-222222222222',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{}}
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url')+'.'+Buffer.from('synthetic-signature').toString('base64url')
const session={access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+36000,expires_in:36000,token_type:'bearer',user}
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 const context=await browser.newContext({viewport:{width:390,height:844}})
 let enabled=false,createStatus=401,createCalls=[],sendCalls=0,verifyStatus=200,existing=false
 let page
 try {
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname
   if(url.origin===new URL(base).origin){
    if(p==='/api/session-policy')return route.fulfill({json:{enabled:false}})
    if(p==='/api/device-session')return route.fulfill({json:{state:'setup',canSetPin:true}})
    if(p==='/api/organization-signup'){
     if(route.request().method()==='GET')return route.fulfill({json:{enabled}})
     const body=route.request().postDataJSON()
     if(body.action==='send'){sendCalls++;return route.fulfill({json:{success:true}})}
     createCalls.push(body)
     return route.fulfill({status:createStatus,json:createStatus===200?{organizationId:'synthetic-org',destination:'/set-pin'}:{error:createStatus===401?'Verify your email again.':'Unable to complete setup. Please retry.'}})
    }
    if(p==='/api/email-login/verify')return route.fulfill({status:verifyStatus,json:verifyStatus===200?{session,state:'setup',hasOrganization:existing}:{error:'That code is invalid. Please try again.'}})
    if(p==='/set-pin')return route.fulfill({contentType:'text/html',body:'<h1>PIN setup destination</h1>'})
    return route.continue()
   }
   if(url.origin==='https://workflow-test.supabase.co')return route.fulfill({json:p==='/auth/v1/user'?user:[]})
   return route.abort()
  })
  page=await context.newPage()
  page.setDefaultTimeout(15000)
  await page.goto(base+'/onboarding-owner')
  await page.getByText('Organization signup is not available yet. Please check back later.').waitFor()
  assert.equal(await page.getByLabel('Email address').count(),0)
  enabled=true
  await page.reload()
  await page.getByLabel('Email address').fill(user.email)
  await page.getByRole('button',{name:'Send verification code',exact:true}).click()
  await page.getByLabel('Email code',{exact:true}).fill('123456')
  verifyStatus=400
  await page.getByRole('button',{name:'Verify email',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'That code is invalid'}).waitFor()
  assert.equal(await page.getByLabel('Email code',{exact:true}).inputValue(),'123456')
  verifyStatus=200
  await page.getByRole('button',{name:'Verify email',exact:true}).click()
  await page.getByLabel('Your full name').fill('Synthetic Owner')
  await page.getByLabel('Organization name',{exact:true}).fill('Synthetic Organization')
  await page.getByLabel('Organization type').selectOption('Other')
  await page.getByLabel('First branch name').fill('Main')
  await page.getByRole('button',{name:'Create organization and start trial'}).click()
  await page.getByText('Your organization details will stay here while you verify your email again.').waitFor()
  assert.equal(await page.getByLabel('Organization name',{exact:true}).inputValue(),'Synthetic Organization')
  // Move only the local resend clock; no real email or external clock changes.
  await page.clock.install()
  await page.clock.fastForward(61000)
  await page.getByRole('button',{name:'Verify email again',exact:true}).click()
  await page.getByLabel('Email code',{exact:true}).waitFor()
  assert.equal(sendCalls,2)
  await page.getByLabel('Email code',{exact:true}).fill('123456')
  await page.getByRole('button',{name:'Verify email',exact:true}).click()
  assert.equal(await page.getByLabel('First branch name').inputValue(),'Main')
  createStatus=503
  await page.getByRole('button',{name:'Create organization and start trial'}).click()
  await page.getByRole('alert').filter({hasText:'Unable to complete setup'}).waitFor()
  assert.equal(await page.getByLabel('Your full name').inputValue(),'Synthetic Owner')
  createStatus=200
  await page.getByRole('button',{name:'Create organization and start trial'}).click()
  await page.getByRole('heading',{name:'PIN setup destination'}).waitFor()
  assert.equal(createCalls.length,3)
  assert.deepEqual(createCalls[0],createCalls[1]);assert.deepEqual(createCalls[1],createCalls[2])
  // A verified existing member goes to PIN setup, without creating another org.
  await page.evaluate(()=>localStorage.clear())
  existing=true
  await page.goto(base+'/onboarding-owner')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByRole('button',{name:'Send verification code',exact:true}).click()
  await page.getByLabel('Email code',{exact:true}).fill('123456')
  await page.getByRole('button',{name:'Verify email',exact:true}).click()
  await page.getByRole('heading',{name:'PIN setup destination'}).waitFor()
  assert.equal(createCalls.length,3)
  console.log('PASS: closed signup, email verification errors, expired verification recovery, retained fields, failed creation retry, PIN destination, existing member redirect')
 }catch(error){if(page)console.error((await page.locator('body').innerText()).slice(0,4000));throw error}
 finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
