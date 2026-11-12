const {app,BrowserWindow,ipcMain,screen,globalShortcut,Tray,Menu,nativeImage,shell,dialog,clipboard,desktopCapturer,Notification,session,nativeTheme}=require('electron');
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {spawn}=require('child_process');const WindowsBridge=require('./native');
let win,tray,bridge,expanded=false,settings,state,editor,polling=false,recording=false;let timers=[];let lastClip='';let autoHidden=false;
let collapseTimer;
let capturing = false;
let controlsBridge;
let controlsVisible = false;
let controlsCalls = 0;
let controlsRelease;
let mediaPollTimer;
let settingsWindow;
let musicPlaying = false;
let miniPlayer = false;
let mediaWidthTimer;
let preferredMedia = '';
let foregroundApp = '';
let appRestricted = false;
const collapseDelay=360;
const compactSize = { width: 184, height: 38 };
const panelSize = { width: 856, height: 514 };const hotkeys=[];
const defaults={gpuAcceleration:true,musicCharacter:'same',musicMode:'cover',hoverDelay:150,leaveDelay:350,eventDuration:1650,hiddenModules:[],hiddenTabs:[],restrictedApps:'',ruleMode:'hide',clickThrough:false,rainAlerts:false,accent:'#bba8ff',position:'center',top:12,monitor:0,scale:1,opacity:1,theme:'dark',character:'pug',autostart:false,hover:true,collapseOnLeave:true,shape:'capsule',autohide:false,hideFullscreen:true,clipboard:false,shortcut:'Alt+Space',items:[{name:'Spotify',target:'spotify:',fallback:'https://open.spotify.com',symbol:'♫',group:''},{name:'Codex',target:'https://chatgpt.com/codex',symbol:'⌘',group:''},{name:'ChatGPT',target:'https://chatgpt.com',symbol:'✳',group:''}]};
const emptyState={clips:[],shelf:[],notes:[{id:'welcome',name:'Моя заметка',folder:'Личное',text:'Добро пожаловать в Orbit.\n\nЗдесь можно хранить идеи и задачи.'}],reminders:[],timer:null,colors:[]};
const dataPath=name=>path.join(app.getPath('userData'),name);function read(name,fallback){try{return JSON.parse(fs.readFileSync(dataPath(name),'utf8'))}catch{return structuredClone(fallback)}}
if (read('settings.json',defaults)?.gpuAcceleration === false) app.disableHardwareAcceleration();
function write(name,data){const p=dataPath(name);fs.writeFileSync(p+'.tmp',JSON.stringify(data,null,2));fs.renameSync(p+'.tmp',p)}function saveState(){write('state.json',state)}
function send(channel,data){if(win&&!win.isDestroyed())win.webContents.send(channel,data)}
function selectedDisplay() {
  return screen.getAllDisplays()[settings.monitor] || screen.getPrimaryDisplay();
}
function topEdge(display) {
  return settings.shape === 'edge' ? display.bounds.y : display.workArea.y + settings.top;
}
function bounds() {
  if (!win || win.isDestroyed()) return;
  const display = selectedDisplay();
  const area = display.workArea;
  const top = topEdge(display);
  const scale = Math.min(settings.scale, (area.width - 32) / panelSize.width,
    Math.max(.6, (area.y + area.height - top - 8) / panelSize.height));
  const hasMusic = musicPlaying || mediaWidthTimer !== undefined;
  const musicWidth = ['title','lyrics','mini'].includes(settings.musicMode) ? 366 : 232;
  const size = expanded || collapseTimer !== undefined ? panelSize : miniPlayer ? { width: musicWidth, height: 94 }
    : hasMusic ? { ...compactSize, width: musicWidth } : compactSize;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  let x = area.x + Math.round((area.width - width) / 2);
  if (settings.position === 'left') x = area.x + 16;
  if (settings.position === 'right') x = area.x + area.width - width - 16;
  const y = autoHidden && !expanded ? display.bounds.y - height + 9 : top;
  win.setBounds({ x, y, width, height });
  win.webContents.setZoomFactor(scale);
  win.setIgnoreMouseEvents(settings.clickThrough && !expanded && !miniPlayer, {forward:true});
}
function expand(value, focus = false) {
  const wasExpanded = expanded;
  expanded = Boolean(value);
  miniPlayer = false;
  autoHidden = false;
  if (expanded) {
    clearTimeout(collapseTimer);
    collapseTimer = undefined;
  } else if (wasExpanded) {
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined;
      bounds();
    }, collapseDelay);
  }
  bounds();
  send('expanded', expanded);
  if (expanded) pollWindows();
  if (focus) {
    win.show();
    win.focus();
  }
}
function openSettings(section = 'general', add = false) {
  const request = { section, add };
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (settingsWindow.webContents.isLoadingMainFrame()) {
      const contents = settingsWindow.webContents;
      contents.once('did-finish-load', () => contents.send('settings-section', request));
    } else settingsWindow.webContents.send('settings-section', request);
    return;
  }
  const window = settingsWindow = shellWindow('settings.html', {
    title: 'Orbit — настройки', width: 1020, height: 790, minWidth: 640, minHeight: 460,
    show: false, backgroundColor: '#111114', icon: path.join(__dirname, 'icon.png')
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  window.webContents.once('did-finish-load', () => window.webContents.send('settings-section', request));
  window.on('closed', () => { settingsWindow = undefined; });
}
function showTab(tab){if(tab==='settings'){openSettings();return;}expand(true,true);send('tab',tab)}
function apply(){if(settings.musicMode!=='mini')miniPlayer=false;refreshAppRule();if(!settings.autohide&&!(appRestricted&&settings.ruleMode==='hide'))autoHidden=false;win.setOpacity(settings.opacity);nativeTheme.themeSource=settings.theme;app.setLoginItemSettings({openAtLogin:settings.autostart});registerKeys();bounds()}
function registerKeys(){globalShortcut.unregisterAll();hotkeys.length=0;const entries=[[settings.shortcut,()=>showTab('search')],['Control+Alt+I',()=>expand(!expanded,true)],['Control+Alt+V',()=>showTab('clipboard')],['Control+Alt+S',()=>capture('edit').catch(e=>send('error',e.message))],['Control+Alt+O',()=>capture('ocr').catch(e=>send('error',e.message))],['Control+Alt+C',()=>capture('color').catch(e=>send('error',e.message))],['Control+Alt+Q',()=>capture('qr').catch(e=>send('error',e.message))],['Control+Alt+R',()=>{showTab('tools');send('record-toggle')}],['Control+Alt+Shift+V',()=>{clipboard.writeText(clipboard.readText());expand(false);bridge.call('paste').catch(e=>send('error',e.message))}]];for(const item of settings.items)if(item.hotkey)entries.push([item.hotkey,()=>launch(item.target).catch(e=>send('error',e.message))]);for(const [key,cb]of entries){try{if(key&&!globalShortcut.register(key,cb))hotkeys.push(key)}catch{hotkeys.push(key)}}send('hotkeys',hotkeys)}
function shellWindow(file,options={}){const w=new BrowserWindow({width:900,height:700,backgroundColor:'#121217',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true},...options});w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());w.loadFile(file);return w}
function create(){if(process.platform==='win32')app.setAppUserModelId('Orbit.Desktop');settings={...defaults,...read('settings.json',defaults)};if(settings.character==='orb')settings.character='pug';state={...emptyState,...read('state.json',emptyState)};bridge=new WindowsBridge();win=shellWindow('index.html',{...compactSize,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false});win.setAlwaysOnTop(true,'floating');win.setContentProtection(true);apply();win.webContents.on('did-finish-load',()=>{lastSystemSnapshot='';sentCoverRevision=undefined;send('hotkeys',hotkeys);pollWindows()});
tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')));tray.setToolTip('Orbit • '+settings.shortcut);tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Orbit',click:()=>showTab('home')},{label:'Настройки',click:()=>showTab('settings')},{label:'Свернуть',click:()=>expand(false)},{type:'separator'},{label:'Выход',click:()=>app.quit()}]));tray.on('click',()=>expand(!expanded,true));screen.on('display-metrics-changed',bounds);screen.on('display-removed',bounds);
session.defaultSession.setPermissionRequestHandler((wc,permission,cb)=>cb(wc===win.webContents&&['media','display-capture'].includes(permission)));session.defaultSession.setDisplayMediaRequestHandler(async(request,cb)=>{try{if(request.securityOrigin!=='file://'&&request.securityOrigin!=='file:'){cb({});return}const sources=await desktopCapturer.getSources({types:['screen']});const display=screen.getAllDisplays()[settings.monitor]||screen.getPrimaryDisplay();const video=sources.find(s=>s.display_id===String(display.id))||sources[0];cb({video,audio:process.platform==='win32'?'loopback':undefined})}catch{cb({})}});
timers.push(setInterval(tick,1000),setInterval(edge,100),setInterval(pollLayout,250));pollLayout();pollWindows();}
let layoutPending = false;
let lastLayout;
let lastClipboardSequence;
let layoutRevealUntil = 0;
async function pollLayout() {
  if (layoutPending) return;
  layoutPending = true;
  try {
    const layout = await bridge.call('keyboard', {clipboard: settings.clipboard});
    const sequence = layout?.clipboardSequence;
    if (settings.clipboard && Number.isInteger(sequence) && sequence !== lastClipboardSequence) {
      lastClipboardSequence = sequence;
      pollClipboard();
    }
    if (!layout?.id) return;
    if (lastLayout && layout.caps !== lastLayout.caps) {
      revealIndicator();
      send('caps', layout.caps);
    }
    if (lastLayout && layout.id !== lastLayout.id) {
      revealIndicator();
      send('layout', layout.label);
    }
    lastLayout = layout;
  } catch {
    // The periodic system status reports bridge failures.
  } finally {
    layoutPending = false;
  }
}
function revealIndicator() {
  layoutRevealUntil = Date.now() + settings.eventDuration + 50;
  if (autoHidden && win.isVisible()) {
    autoHidden = false;
    bounds();
  }
}
function edge() {
  const shouldHide = settings.autohide || appRestricted && settings.ruleMode === 'hide';
  if (!shouldHide && autoHidden) {autoHidden=false;bounds()}
  if (!shouldHide || expanded || miniPlayer || collapseTimer !== undefined || !win?.isVisible() ||
      Date.now() < layoutRevealUntil) return;
  const cursor = screen.getCursorScreenPoint();
  const box = win.getBounds();
  const top = selectedDisplay().bounds.y;
  const isOver = cursor.x >= box.x && cursor.x < box.x + box.width &&
    cursor.y >= top && cursor.y < box.y + box.height;
  if (autoHidden === isOver) {
    autoHidden = !isOver;
    bounds();
  }
}
let coverRevision;
let sentCoverRevision;
let coverDataUrl = '';
let lastSystemSnapshot = '';
function publishSystem(snapshot) {
  const media = snapshot.media;
  if (media && Object.hasOwn(media, 'cover')) {
    coverRevision = media.coverRevision;
    const image = media.cover && nativeImage.createFromBuffer(Buffer.from(media.cover, 'base64'));
    coverDataUrl = image && !image.isEmpty() ? image.resize({ width: 128 }).toDataURL() : '';
    delete media.cover;
  }
  if (!media) {
    coverRevision = undefined;
    sentCoverRevision = undefined;
    coverDataUrl = '';
  }
  const fingerprint = JSON.stringify(snapshot);
  const newCover = media && sentCoverRevision !== coverRevision;
  if (fingerprint === lastSystemSnapshot && !newCover) return;
  lastSystemSnapshot = fingerprint;
  if (newCover) {
    media.cover = coverDataUrl;
    sentCoverRevision = coverRevision;
  }
  send('system', snapshot);
}
function refreshAppRule() {
  appRestricted = settings.restrictedApps.split(/[,\n]/).some(name =>
    name.trim().toLowerCase().replace(/\.exe$/, '') === foregroundApp && foregroundApp);
}
function updateMusicBounds(playing) {
  if (playing === musicPlaying) return;
  musicPlaying = playing;
  clearTimeout(mediaWidthTimer);
  mediaWidthTimer = undefined;
  if (!playing) {
    miniPlayer = false;
    mediaWidthTimer = setTimeout(() => { mediaWidthTimer = undefined; bounds(); }, 350);
  }
  bounds();
}
async function pollWindows() {
  if (polling || !win || win.isDestroyed()) return;
  clearTimeout(mediaPollTimer);
  polling = true;
  try {
    const snapshot = await bridge.call('status', { preferred: preferredMedia, coverRevision });
    updateMusicBounds(Boolean(snapshot.media?.playing));
    if (snapshot.foreground) foregroundApp = snapshot.foreground.toLowerCase();
    refreshAppRule();
    snapshot.restricted = appRestricted;
    snapshot.inactive = snapshot.idleSeconds >= 90;
    delete snapshot.foreground;
    delete snapshot.idleSeconds;
    publishSystem(snapshot);
    if (capturing || editor || win.isDestroyed()) return;
    if (settings.hideFullscreen && snapshot.fullscreen && !recording) win.hide();
    else if (!win.isVisible()) win.showInactive();
  } catch (error) {
    send('native-error', error.message);
  } finally {
    polling = false;
    if (win && !win.isDestroyed()) {
      mediaPollTimer = setTimeout(pollWindows, musicPlaying || expanded || miniPlayer ? 900 : 2300);
    }
  }
}
function pollClipboard(){if(!settings.clipboard)return;try{const formats=clipboard.availableFormats();if(formats.some(f=>/ExcludeClipboardContentFromMonitorProcessing|CanIncludeInClipboardHistory|Password/i.test(f)))return;const img=clipboard.readImage();let item;if(!img.isEmpty()){const b=img.toPNG();if(b.length>8*1024*1024)return;const hash=crypto.createHash('sha256').update(b).digest('hex');if(hash===lastClip)return;lastClip=hash;item={type:'image',data:img.resize({width:Math.min(1600,img.getSize().width)}).toDataURL()}}else{const text=clipboard.readText();if(!text||text.length>100000)return;const hash=crypto.createHash('sha256').update(text).digest('hex');if(hash===lastClip)return;lastClip=hash;item={type:'text',text}}const exists=state.clips.find(c=>item.type===c.type&&(item.text?item.text===c.text:item.data===c.data));if(exists)return;state.clips.unshift({...item,id:crypto.randomUUID(),at:Date.now(),pinned:false});const pins=state.clips.filter(c=>c.pinned),others=state.clips.filter(c=>!c.pinned).slice(0,60);state.clips=[...pins,...others];saveState();send('clips',state.clips)}catch{}}
function alert(title,body,details={}){if(Notification.isSupported())new Notification({title,body,silent:false}).show();expand(true);send('alarm',{title,body,...details});}
function tick(){let changed=false;if(state.timer&&!state.timer.paused&&Date.now()>=state.timer.end){const total=state.timer.total;state.timer=null;alert('Таймер завершён','Время вышло. Можно сделать перерыв.',{kind:'timer',total});changed=true}for(const r of state.reminders){if(!r.done&&r.at<=Date.now()){alert('Напоминание',r.text,{kind:'reminder'});if(r.repeat==='daily'){const date=new Date(r.at);do{date.setDate(date.getDate()+1)}while(date.getTime()<=Date.now());r.at=date.getTime()}else r.done=true;changed=true}}if(changed){saveState();send('state',state)}}
async function launch(t){if(/^https?:\/\//i.test(t)||/^(spotify|steam|ms-settings):/i.test(t)){await shell.openExternal(t);return}if(/^[a-z]:\\/i.test(t)&&fs.existsSync(t)){const error=await shell.openPath(t);if(error)throw Error(error);return}throw Error('Укажи ссылку https://, spotify:, steam: или путь к существующему файлу')}
async function capture(mode){if(editor&&!editor.isDestroyed()){editor.focus();return}if(capturing)return;capturing=true;expand(false);win.hide();await new Promise(r=>setTimeout(r,220));try{const display=screen.getAllDisplays()[settings.monitor]||screen.getPrimaryDisplay();const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});const source=sources.find(s=>s.display_id===String(display.id))||sources[0];if(!source||source.thumbnail.isEmpty())throw Error('Windows не разрешила захват экрана');if(mode==='full'){clipboard.writeImage(source.thumbnail);win.showInactive();return}const image=source.thumbnail.toDataURL();editor=shellWindow('capture.html',{x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:display.bounds.height,frame:false,alwaysOnTop:true});editor.setContentProtection(true);editor.webContents.once('did-finish-load',()=>editor.webContents.send('capture',{image,mode}));editor.on('closed',()=>{editor=null;win.showInactive()})}catch(e){win.showInactive();throw e}finally{capturing=false}}
function handler(name,fn){ipcMain.handle(name,async(e,...args)=>{const trusted=e.sender===win?.webContents||e.sender===editor?.webContents||e.sender===settingsWindow?.webContents;if(!trusted)throw Error('Unknown window');try{return await fn(...args)}catch(err){return {error:err.message}}})}
handler('open-settings',(section,add)=>openSettings(section,add));
handler('media-source', source => {
  preferredMedia = typeof source === 'string' ? source.slice(0, 300) : '';
  pollWindows();
  return true;
});
handler('compact-mini', value => {
  miniPlayer = Boolean(value && !expanded && musicPlaying && settings.musicMode === 'mini');
  autoHidden = false;
  bounds();
  return miniPlayer;
});
handler('get',()=>({settings,state,displays:screen.getAllDisplays().map((d,i)=>({index:i,label:d.label||'Монитор '+(i+1)})),version:app.getVersion(),platform:process.platform,gpuAccelerationActive:app.isHardwareAccelerationEnabled(),hotkeys}));
handler('expand',v=>expand(v));handler('quit',()=>app.quit());
handler('lyrics', async track => {
  const title = String(track?.title ?? '').trim().slice(0, 250);
  const artist = String(track?.artist ?? '').trim().slice(0, 250);
  if (!title || !artist) throw Error('В медиасессии нет названия или исполнителя');
  const query = new URLSearchParams({ track_name: title, artist_name: artist });
  const response = await require('electron').net.fetch('https://lrclib.net/api/search?' + query, {
    headers: { 'User-Agent': 'Orbit/' + app.getVersion() },
    signal: AbortSignal.timeout(8000),
  }).catch(() => { throw Error('Не удалось подключиться к LRCLIB'); });
  if (!response.ok) throw Error('LRCLIB временно недоступен');
  const results = await response.json();
  const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
  const matches = results.filter(entry =>
    normalize(entry.trackName) === normalize(title) && normalize(entry.artistName) === normalize(artist));
  const similarDuration = matches.filter(entry => Math.abs(entry.duration - track.duration) <= 3);
  const candidates = similarDuration.length ? similarDuration : matches;
  const albumMatches = candidates.filter(entry => track.album && normalize(entry.albumName) === normalize(track.album));
  const versions = albumMatches.length ? albumMatches : candidates;
  const match = versions.find(entry => entry.syncedLyrics) ?? versions[0];
  if (!match) return { text: 'В LRCLIB нет текста для этого трека' };
  if (match.instrumental) return { text: 'Инструментальный трек' };
  const lyrics = match.plainLyrics || match.syncedLyrics?.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, '');
  const synced = (!track.duration || Math.abs(match.duration - track.duration) <= 3)
    ? match.syncedLyrics?.slice(0, 40000) : undefined;
  return { text: lyrics?.trim().slice(0, 25000) || 'В LRCLIB нет текста для этого трека', synced };
});
handler('save',s=>{if(!s||!Array.isArray(s.items)||s.items.length>24)throw Error('Максимум 24 приложения');const oldClip=settings.clipboard;settings={...defaults,...s,accent:/^#[0-9a-f]{6}$/i.test(s.accent)?s.accent:defaults.accent,position:['left','center','right'].includes(s.position)?s.position:'center',gpuAcceleration:s.gpuAcceleration!==false,musicCharacter:['same','pug','sphere','eyes','spark','pixel'].includes(s.musicCharacter)?s.musicCharacter:'same',
musicMode:['cover','title','mini','lyrics'].includes(s.musicMode)?s.musicMode:'cover',
hoverDelay:Math.max(0,Math.min(1500,Number(s.hoverDelay)||0)),
leaveDelay:Math.max(0,Math.min(1500,Number(s.leaveDelay)||0)),
eventDuration:[1050,1650,2800].includes(Number(s.eventDuration))?Number(s.eventDuration):1650,
hiddenModules:Array.isArray(s.hiddenModules)?s.hiddenModules.filter(key=>['player','audio','apps','edit','full','ocr','qr','color','text','record','command'].includes(key)):[],
hiddenTabs:Array.isArray(s.hiddenTabs)?s.hiddenTabs.filter(key=>['clipboard','shelf','notes','tools','weather','controls'].includes(key)):[],
restrictedApps:typeof s.restrictedApps==='string'?s.restrictedApps.slice(0,2000):'',
ruleMode:s.ruleMode==='manual'?'manual':'hide',clickThrough:Boolean(s.clickThrough),rainAlerts:Boolean(s.rainAlerts),
shape:s.shape==='edge'?'edge':'capsule',collapseOnLeave:s.collapseOnLeave!==false,top:Math.max(0,Math.min(200,Number(s.top)||0)),scale:Math.max(.8,Math.min(2,Number(s.scale)||1)),opacity:Math.max(.45,Math.min(1,Number(s.opacity)||1)),monitor:Math.max(0,Number(s.monitor)||0),theme:['dark','light','system'].includes(s.theme)?s.theme:'dark',autostart:!!s.autostart,clipboard:!!s.clipboard,items:s.items.map(i=>({name:String(i.name).slice(0,40),target:String(i.target).slice(0,2048),fallback:String(i.fallback||'').slice(0,2048),symbol:String(i.symbol||'↗').slice(0,4),group:String(i.group||'').slice(0,30),hotkey:String(i.hotkey||'').slice(0,60)}))};write('settings.json',settings);if(!oldClip&&settings.clipboard){lastClip='';lastClipboardSequence=undefined;pollLayout();}apply();send('settings-changed',settings);return {settings,hotkeys}});
handler('pick',async()=>{const r=await dialog.showOpenDialog(settingsWindow||win,{title:'Выбери приложение или ярлык',properties:['openFile'],filters:[{name:'Приложения',extensions:['exe','lnk','url']}]});return r.canceled?null:r.filePaths[0]});
const fileIcons = new Map();
const localFile = file => typeof file === 'string' && /^[a-z]:\\/i.test(file);
async function readFileIcon(file) {
  let sources = [file];
  const extension = path.extname(file).toLowerCase();
  try {
    if (extension === '.lnk') {
      const shortcut = shell.readShortcutLink(file);
      sources = shortcut.icon && shortcut.iconIndex === 0
        ? [shortcut.icon, shortcut.target, file]
        : shortcut.icon ? [file, shortcut.target] : [shortcut.target, file];
    } else if (extension === '.url' && fs.statSync(file).size <= 65536) {
      const contents = fs.readFileSync(file);
      const shortcut = contents.toString(contents[0] === 255 && contents[1] === 254 ? 'utf16le' : 'utf8');
      const icon = /^IconFile=(.+)$/im.exec(shortcut)?.[1].trim();
      const index = /^IconIndex=(.+)$/im.exec(shortcut)?.[1].trim();
      if (icon && (!index || index === '0')) sources.unshift(icon.replace(/^"|"$/g, ''));
    }
  } catch {
    // Broken shortcuts can still have a Windows file-type icon.
  }
  for (const source of sources) {
    if (!localFile(source) || !fs.existsSync(source)) continue;
    try {
      if (path.extname(source).toLowerCase() === '.ico') {
        const png = await bridge.call('file-ico', { path: source });
        if (png) return 'data:image/png;base64,' + png;
        continue;
      }
      const icon = await app.getFileIcon(source, { size: 'normal' });
      if (!icon.isEmpty()) return icon.toDataURL();
    } catch {}
  }
  return '';
}
handler('file-icon', file => {
  if (!localFile(file) || !(settings.items.some(item => item.target === file) ||
    state.shelf.some(item => item.path === file))) return '';
  if (!fileIcons.has(file)) {
    if (fileIcons.size >= 128) fileIcons.delete(fileIcons.keys().next().value);
    const request = readFileIcon(file).then(icon => {
      if (!icon && fileIcons.get(file) === request) fileIcons.delete(file);
      return icon;
    });
    fileIcons.set(file, request);
  }
  return fileIcons.get(file);
});
handler('drop-launcher', paths => {
  if (!Array.isArray(paths) || paths.length > 100) throw Error('Слишком много файлов');
  const candidates = [...new Set(paths.filter(file => typeof file === 'string' && /^[a-z]:\\/i.test(file) && fs.existsSync(file)))];
  if (!candidates.length) throw Error('Лаунчер принимает файлы и папки с локальных дисков');
  const known = new Set(settings.items.map(item => item.target.toLowerCase()));
  const additions = candidates.filter(file => {
    const key = file.toLowerCase();
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (settings.items.length + additions.length > 24) throw Error('В лаунчере может быть до 24 ярлыков');
  const items = settings.items.concat(additions.map(file => ({
    name: (path.basename(file, path.extname(file)) || file).slice(0, 40), target: file, symbol: '↗', group: ''
  })));
  const next = { ...settings, items };
  write('settings.json', next);
  settings = next;
  if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send('launcher-added',items.slice(items.length-additions.length));
  return { settings, count: additions.length };
});
function releaseControlsLater() {
  clearTimeout(controlsRelease);
  if (controlsVisible || controlsCalls || !controlsBridge) return;
  controlsRelease = setTimeout(() => {
    if (controlsVisible || controlsCalls) return;
    controlsBridge?.close();
    controlsBridge = undefined;
  }, 3500);
}
ipcMain.on('controls-view', (event, visible) => {
  if (event.sender !== win?.webContents) return;
  controlsVisible = Boolean(visible);
  releaseControlsLater();
});
handler('controls', async command => {
  const action = command === 'status' ? 'controls-status' : command === 'theme' ? 'controls-theme' :
    ['lock','sleep','restart','shutdown'].includes(command) ? 'power' : undefined;
  if (!action) throw Error('Неизвестная команда управления');
  clearTimeout(controlsRelease);
  controlsBridge ??= new WindowsBridge();
  controlsCalls++;
  try {
    return await controlsBridge.call(action, { command });
  } finally {
    controlsCalls--;
    releaseControlsLater();
  }
});
handler('happ', async command => {
  if (command === 'status') return bridge.call('happ-status');
  if (command === 'toggle') {
    const status = await bridge.call('happ-status');
    if (!status.installed) throw Error('В Windows не зарегистрирован клиент Happ');
    await shell.openExternal('happ://toggle');
    return { ok: true };
  }
  if (command === 'ip') {
    const response = await require('electron').net.fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('Не удалось проверить внешний IP');
    const data = await response.json();
    if (!require('net').isIP(data.ip) || !/^[A-Z]{2}$/.test(data.country)) throw Error('Сервис не вернул IP или страну');
    return { ip: data.ip, country: data.country };
  }
  throw Error('Неизвестная команда Happ');
});
handler('launch',async index=>{const item=settings.items[index];if(!item)throw Error('Приложение не найдено');try{await launch(item.target)}catch(e){if(!item.fallback)throw e;await launch(item.fallback)}return {ok:true}});
handler('web',url=>{if(!/^https?:\/\//i.test(url))throw Error('Разрешены ссылки HTTP/HTTPS');return shell.openExternal(url)});
const eqBands = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];
handler('eq-profile', gains => {
  const file = dataPath('Orbit-EQ.txt');
  if (gains === undefined) return { gains: read('eq.json', eqBands.map(() => 0)), file };
  if (!Array.isArray(gains) || gains.length !== eqBands.length ||
      !gains.every(value => Number.isInteger(value) && value >= -12 && value <= 12)) throw Error('Некорректные настройки эквалайзера');
  const preamp = -Math.max(0, ...gains);
  const curve = eqBands.map((frequency, i) => frequency + ' ' + gains[i]).join('; ');
  fs.writeFileSync(file + '.tmp', 'Preamp: ' + preamp + ' dB\nGraphicEQ: ' + curve + '\n');
  fs.renameSync(file + '.tmp', file);
  write('eq.json', gains);
  return { gains, file };
});
handler('audio', (command, value) => {
  if (command === 'level' && Number.isFinite(value)) return bridge.call('audio', { command, level: value / 100 });
  if (command === 'select' && typeof value === 'string' && value.length < 256) return bridge.call('audio', { command, endpoint: value });
  if (command === 'status' || command === 'mute') return bridge.call('audio', { command });
  throw Error('Неизвестная команда управления звуком');
});
handler('native',(action,args)=>{if(!['media','volume','dictation'].includes(action))throw Error('Неизвестное действие');if(action==='dictation')expand(false);return bridge.call(action,args||{})});
handler('system-link',key=>{const links={ethernet:'ms-settings:network-ethernet',wifi:'ms-settings:network-wifi',bluetooth:'ms-settings:bluetooth',vpn:'ms-settings:network-vpn',sound:'ms-settings:sound',theme:'ms-settings:personalization-colors',notifications:'ms-settings:notifications',apps:'ms-settings:appsfeatures'};if(!links[key])throw Error('Неизвестный раздел');return shell.openExternal(links[key])});
handler('clips',()=>state.clips);handler('clip-action',async(id,action)=>{const c=state.clips.find(c=>c.id===id);if(action==='clear'){state.clips=state.clips.filter(c=>c.pinned)}else if(!c)throw Error('Запись не найдена');else if(action==='pin')c.pinned=!c.pinned;else if(action==='delete')state.clips=state.clips.filter(c=>c.id!==id);else if(action==='copy'||action==='paste'){if(c.type==='text')clipboard.writeText(c.text);else clipboard.writeImage(nativeImage.createFromDataURL(c.data));if(action==='paste'){expand(false);await bridge.call('paste')}}saveState();send('clips',state.clips);return state.clips});
handler('copy',text=>{clipboard.writeText(String(text));return true});
handler('shelf-add',async paths=>{if(!paths){const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections']});paths=r.filePaths}for(const p of paths||[])if(typeof p==='string'&&fs.existsSync(p)&&!state.shelf.some(s=>s.path===p))state.shelf.push({id:crypto.randomUUID(),path:p,name:path.basename(p)});state.shelf=state.shelf.slice(-100);saveState();return state.shelf});
handler('shelf-action',async(id,action)=>{const file=state.shelf.find(f=>f.id===id);if(!file)throw Error('Файл не найден');if(action==='remove'){state.shelf=state.shelf.filter(f=>f.id!==id);saveState()}else if(action==='reveal')shell.showItemInFolder(file.path);else if(action==='open'){const error=await shell.openPath(file.path);if(error)throw Error(error)}return state.shelf});
ipcMain.on('drag-file',(e,id)=>{if(e.sender!==win.webContents)return;const f=state.shelf.find(f=>f.id===id);if(f&&fs.existsSync(f.path))e.sender.startDrag({file:f.path,icon:nativeImage.createFromPath(path.join(__dirname,'icon.png'))})});
handler('notes-save',notes=>{if(!Array.isArray(notes)||notes.length>100)throw Error('Максимум 100 заметок');state.notes=notes.map(n=>({id:String(n.id),name:String(n.name).slice(0,100),folder:String(n.folder||'Личное').slice(0,40),text:String(n.text).slice(0,200000)}));saveState();return true});
handler('timer',command=>{if(command.action==='stop')state.timer=null;else if(command.action==='reset'&&state.timer){state.timer.end=Date.now()+state.timer.total;state.timer.paused=false;delete state.timer.remaining}else if(command.action==='pause'&&state.timer){if(state.timer.paused){state.timer.end=Date.now()+state.timer.remaining;state.timer.paused=false}else{state.timer.remaining=Math.max(0,state.timer.end-Date.now());state.timer.paused=true}}else if(command.action==='start'){const minutes=Number(command.minutes);if(!Number.isFinite(minutes)||minutes<=0||minutes>1440)throw Error('Таймер: от 0 до 1440 минут');state.timer={end:Date.now()+minutes*60000,total:minutes*60000,paused:false}}saveState();send('state',state);return state.timer});
handler('reminder',(action,r)=>{if(action==='add'){if(!r.text||!Number.isFinite(r.at)||r.at<=Date.now())throw Error('Укажи текст и время в будущем');state.reminders.push({id:crypto.randomUUID(),text:String(r.text).slice(0,500),at:r.at,repeat:r.repeat==='daily'?'daily':'once',done:false})}else if(action==='remove')state.reminders=state.reminders.filter(x=>x.id!==r.id);saveState();return state.reminders});
handler('capture',mode=>capture(mode));
handler('capture-result',async result=>{if(result.action==='close'){editor?.close();return}const img=nativeImage.createFromDataURL(result.data||'');if(img.isEmpty())throw Error('Пустое изображение');if(result.action==='copy'){clipboard.writeImage(img);editor?.close();return {ok:true}}if(result.action==='save'){const r=await dialog.showSaveDialog(editor,{defaultPath:path.join(app.getPath('pictures'),'Orbit-'+Date.now()+'.png'),filters:[{name:'PNG',extensions:['png']}]});if(!r.canceled){fs.writeFileSync(r.filePath,img.toPNG());editor?.close()}return {ok:!r.canceled}}if(result.action==='ocr'){const p=dataPath('ocr-temp.png');fs.writeFileSync(p,img.toPNG());try{const text=await bridge.call('ocr',{path:p});clipboard.writeText(text||'');return {text}}finally{fs.rmSync(p,{force:true})}}});
handler('color',hex=>{if(!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Неверный цвет');clipboard.writeText(hex);state.colors=[hex,...state.colors.filter(c=>c!==hex)].slice(0,20);saveState();return true});
handler('qr',async data=>{const jsQR=require('jsqr');const image=nativeImage.createFromDataURL(data);const {width,height}=image.getSize();const bitmap=image.toBitmap();const rgba=new Uint8ClampedArray(bitmap.length);for(let i=0;i<bitmap.length;i+=4){rgba[i]=bitmap[i+2];rgba[i+1]=bitmap[i+1];rgba[i+2]=bitmap[i];rgba[i+3]=bitmap[i+3]}const code=jsQR(rgba,width,height);if(!code)throw Error('QR-код не найден. Выдели область точнее.');clipboard.writeText(code.data);return {text:code.data}});
handler('record-state',v=>{recording=!!v;send('recording',recording);return true});
handler('record-save',async(payload,mime)=>{recording=false;const ext=mime.includes('mp4')?'mp4':'webm';const r=await dialog.showSaveDialog(win,{defaultPath:path.join(app.getPath('videos'),'Orbit-'+Date.now()+'.'+ext),filters:[{name:ext.toUpperCase(),extensions:[ext]}]});if(!r.canceled){fs.writeFileSync(r.filePath,Buffer.from(payload));shell.showItemInFolder(r.filePath)}send('recording',false);return {saved:!r.canceled}});
handler('weather',async(city)=>{const get=async url=>{const res=await require('electron').net.fetch(url,{signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('Погода недоступна: HTTP '+res.status);return res.json()};const geo=await get('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(String(city).slice(0,80))+'&count=1&language=ru&format=json');const loc=geo.results?.[0];if(!loc)throw Error('Город не найден');const forecast=await get(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&wind_speed_unit=ms&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure,is_day&hourly=temperature_2m,weather_code,is_day,precipitation_probability,precipitation,dew_point_2m,surface_pressure,uv_index&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_sum,uv_index_max&timezone=auto&forecast_days=7`);return {location:loc,forecast}});
handler('data-export',async()=>{const r=await dialog.showSaveDialog(settingsWindow||win,{defaultPath:'Orbit-backup.json',filters:[{name:'JSON',extensions:['json']}]});if(!r.canceled)fs.writeFileSync(r.filePath,JSON.stringify({settings,state},null,2));return !r.canceled});
handler('data-folder',()=>shell.openPath(app.getPath('userData')));
if(!app.requestSingleInstanceLock())app.quit();else{app.on('second-instance',()=>win&&showTab('home'));app.whenReady().then(create);app.on('window-all-closed',()=>{});app.on('will-quit',()=>{globalShortcut.unregisterAll();clearTimeout(collapseTimer);clearTimeout(mediaWidthTimer);clearTimeout(mediaPollTimer);clearTimeout(controlsRelease);for(const t of timers)clearInterval(t);bridge?.close();controlsBridge?.close()})}
