const {spawn}=require('child_process');const path=require('path');const readline=require('readline');
class WindowsBridge {
 constructor(){this.pending=new Map();this.sequence=0;this.lastError='';if(process.platform!=='win32')return;this.process=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'native','windows.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});readline.createInterface({input:this.process.stdout}).on('line',line=>{try{const r=JSON.parse(line),p=this.pending.get(r.id);if(p){clearTimeout(p.timer);this.pending.delete(r.id);r.error?p.reject(Error(r.error)):p.resolve(r.result)}}catch{}});this.process.stderr.on('data',b=>{this.lastError=b.toString().slice(-500)});this.process.on('error',e=>this.fail(e));this.process.on('exit',()=>{this.fail(Error(this.lastError||'Windows bridge stopped'));this.process=null});}
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e)}this.pending.clear()}
 call(action,args={}){if(!this.process)return Promise.reject(Error('Функция доступна в Windows 11'));const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Windows не ответила вовремя'))},20000);this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({id,action,own:process.pid,...args})+'\n')})}
 close(){this.process?.kill()}
}
module.exports=WindowsBridge;
