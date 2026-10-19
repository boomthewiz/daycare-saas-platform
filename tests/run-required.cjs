const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),net=require('node:net')
require('./setup.cjs')
const unit=process.argv.includes('--unit')
async function main(){
 if(!unit){
  if(!process.env.REJOYCE_POSTGRES_CLIENT)throw new Error('Required native PostgreSQL client missing. Run npm ci.')
  await new Promise((resolve,reject)=>{const socket=net.connect(55439,'127.0.0.1');socket.setTimeout(3000);socket.once('connect',()=>{socket.end();resolve()});socket.once('error',()=>reject(new Error('Required isolated PostgreSQL server missing on 127.0.0.1:55439. See docs/testing.md. Use test:unit only for an explicitly partial local run.')));socket.once('timeout',()=>{socket.destroy();reject(new Error('Required local PostgreSQL server did not respond'))})})
 }
 const files=fs.readdirSync(__dirname).filter(name=>name.endsWith('.test.cjs')&&(!unit||name!=='attendance-concurrency.test.cjs')).sort().map(name=>path.join(__dirname,name))
 const result=spawnSync(process.execPath,['--require',path.join(__dirname,'setup.cjs'),'--test','--test-concurrency=1',...files],{stdio:'inherit',env:process.env})
 if(result.error)throw result.error
 process.exitCode=result.status??1
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
