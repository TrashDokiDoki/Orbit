$ErrorActionPreference='Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class OrbitNative {
public static long LastForeign;
private static System.Threading.Timer monitor;
public static void Watch(int own) {if(monitor!=null)return;monitor=new System.Threading.Timer(_=>{uint p;var w=GetForegroundWindow();GetWindowThreadProcessId(w,out p);if(p!=own&&p!=0)System.Threading.Interlocked.Exchange(ref LastForeign,w.ToInt64());},null,0,150);}
[DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int max);

[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, out uint p);
[DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint t);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w,out RECT r);
[DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
[DllImport("user32.dll")] private static extern short GetKeyState(int key);
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out PowerStatus status);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
[DllImport("user32.dll", SetLastError=true)] public static extern bool LockWorkStation();
[DllImport("powrprof.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.U1)]
private static extern bool SetSuspendState([MarshalAs(UnmanagedType.U1)] bool hibernate, [MarshalAs(UnmanagedType.U1)] bool force, [MarshalAs(UnmanagedType.U1)] bool disableWake);
[StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Low; public int High; }
[StructLayout(LayoutKind.Sequential)] private struct TokenPrivileges { public int Count; public Luid Id; public uint Flags; }
[DllImport("advapi32.dll", SetLastError=true)] private static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool LookupPrivilegeValue(string host,string name,out Luid id);
[DllImport("advapi32.dll", SetLastError=true)] private static extern bool AdjustTokenPrivileges(IntPtr token,bool disableAll,ref TokenPrivileges state,int length,out TokenPrivileges previous,out int returned);
[DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
[DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
[StructLayout(LayoutKind.Sequential)] private struct LastInput { public uint Size; public uint Tick; }
[DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInput input);
public static int IdleSeconds() {
  var input = new LastInput { Size = (uint)Marshal.SizeOf(typeof(LastInput)) };
  return GetLastInputInfo(ref input) ? (int)(unchecked((uint)Environment.TickCount - input.Tick) / 1000) : 0;
}
public static bool Sleep() {
  IntPtr token;
  if(!OpenProcessToken(GetCurrentProcess(),0x28,out token))return false;
  try {
    Luid id;
    if(!LookupPrivilegeValue(null,"SeShutdownPrivilege",out id))return false;
    var privilege=new TokenPrivileges {Count=1,Id=id,Flags=2};
    var length=Marshal.SizeOf(typeof(TokenPrivileges));
    TokenPrivileges previous;
    int returned;
    if(!AdjustTokenPrivileges(token,false,ref privilege,length,out previous,out returned) || Marshal.GetLastWin32Error()!=0)return false;
    try {return SetSuspendState(false,false,false);}
    finally {AdjustTokenPrivileges(token,false,ref previous,length,out privilege,out returned);}
  } finally {CloseHandle(token);}
}
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,string setting,uint flags,uint timeout,out IntPtr result);
public static void RefreshTheme() {
  IntPtr result;
  SendMessageTimeout(new IntPtr(0xffff), 0x1a, IntPtr.Zero, "ImmersiveColorSet", 2, 150, out result);
}
[DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
public struct RECT {public int Left,Top,Right,Bottom;}
[StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public RECT Bounds; public RECT Work; public uint Flags; }
[StructLayout(LayoutKind.Sequential)] public struct PowerStatus { public byte ACLineStatus,BatteryFlag,BatteryLifePercent,Reserved; public uint BatteryLifeTime,BatteryFullLifeTime; }
public static PowerStatus Power() {
  PowerStatus status;
  return GetSystemPowerStatus(out status) ? status : new PowerStatus { ACLineStatus=255,BatteryLifePercent=255 };
}
public static bool CapsLock() { return (GetKeyState(0x14)&1)!=0; }
public static void Key(byte k) {keybd_event(k,0,0,UIntPtr.Zero);keybd_event(k,0,2,UIntPtr.Zero);}
public static long KeyboardLayout() {
  var window=GetForegroundWindow();
  if(window==IntPtr.Zero)return 0;
  uint pid;
  uint thread=GetWindowThreadProcessId(window,out pid);
  return thread==0?0:GetKeyboardLayout(thread).ToInt64();
}
public static object State(int own) {
  var window=GetForegroundWindow();
  uint pid;
  uint thread=GetWindowThreadProcessId(window,out pid);
  bool full=false;
  if(window!=IntPtr.Zero && pid!=own && !IsIconic(window)){
    RECT rect;
    var monitor=new MonitorInfo { Size=Marshal.SizeOf(typeof(MonitorInfo)) };
    var handle=MonitorFromWindow(window,2);
    if(handle!=IntPtr.Zero && GetWindowRect(window,out rect) && GetMonitorInfo(handle,ref monitor)){
      var bounds=monitor.Bounds;
      var name=new StringBuilder(32);
      GetClassName(window,name,name.Capacity);
      var cls=name.ToString();
      full=cls!="Progman"&&cls!="WorkerW"&&rect.Left<=bounds.Left&&rect.Top<=bounds.Top&&rect.Right>=bounds.Right&&rect.Bottom>=bounds.Bottom;
    }
  }
  return new {handle=window.ToInt64(),pid=pid,own=pid==own,layout=thread==0?0:((long)GetKeyboardLayout(thread)&0xffff),caps=CapsLock(),full=full};
}
}
'@
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod})[0]
function Await($operation,[Type]$type){
  $task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation))
  try {if(-not $task.Wait(6000)){throw 'Windows API timeout'}}
  catch {if($task.IsFaulted){throw $task.Exception.GetBaseException()};throw}
  $task.Result
}
$manager=$null
$lastHandle=0
function Manager {if($null -eq $script:manager){$t=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime];$script:manager=Await ($t::RequestAsync()) $t};$script:manager}
function Select-Media($current,$sessions,[string]$preferred,[bool]$strict){
  if($preferred){
    if($current -and $current.SourceAppUserModelId -eq $preferred){return $current}
    foreach($session in $sessions){if($session.SourceAppUserModelId -eq $preferred){return $session}}
    if($strict){return}
  }
  if($current -and [int]$current.GetPlaybackInfo().PlaybackStatus -eq 4){return $current}
  foreach($session in $sessions){if([int]$session.GetPlaybackInfo().PlaybackStatus -eq 4){return $session}}
  if($current){return $current}
  $sessions | Select-Object -First 1
}
$coverKey=$null
$cover=$null
$coverRevision=0
$coverRetryAt=[datetime]::MinValue
$asStream=([IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1})[0]
function Read-Cover($thumbnail){
  if($null -eq $thumbnail){return}
  $winrtStream=Await ($thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime])
  $stream=$asStream.Invoke($null,@($winrtStream))
  try {
    if($stream.Length -eq 0 -or $stream.Length -gt 1MB){return}
    $reader=[IO.BinaryReader]::new($stream)
    $bytes=$reader.ReadBytes([int]$stream.Length)
    [Convert]::ToBase64String($bytes)
  } finally {$stream.Dispose()}
}
while($null -ne ($line=[Console]::ReadLine())) {
try {
$r=$line|ConvertFrom-Json;$v=$null
switch($r.action){
'network-tool-status' {
  $service = Get-Service -Name 'zapret' -ErrorAction SilentlyContinue
  $proxy = [string]$r.proxy
  $running = $false
  if ($proxy) {
    $name = [IO.Path]::GetFileNameWithoutExtension($proxy)
    $running = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $proxy }).Count -gt 0
  }
  $v = @{ zapret = if ($service) { $service.Status.ToString() } else { $null }; proxyRunning = $running }
}
'network-tool-stop-proxy' {
  $proxy = [string]$r.proxy
  $name = [IO.Path]::GetFileNameWithoutExtension($proxy)
  if ($name -notmatch '^TgWsProxy_windows(_arm64)?$') { throw 'Неверное имя TG WS Proxy' }
  $processes = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $proxy }
  foreach ($process in ($processes | Sort-Object StartTime)) {
    if (!$process.HasExited) {
      try { Stop-Process -InputObject $process -ErrorAction Stop }
      catch { if (!$process.HasExited) { throw } }
    }
  }
  $v = $true
}
'file-ico' {
  if(-not ('System.Drawing.Icon' -as [type])){Add-Type -AssemblyName System.Drawing}
  $icon=[System.Drawing.Icon]::new([string]$r.path,48,48)
  try {
    $bitmap=$icon.ToBitmap()
    try {
      $stream=[IO.MemoryStream]::new()
      try {
        $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
        $v=[Convert]::ToBase64String($stream.ToArray())
      } finally {$stream.Dispose()}
    } finally {$bitmap.Dispose()}
  } finally {$icon.Dispose()}
}
'controls-status' {
  $network=Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {
    $_.PhysicalMediaType -in @('802.3','Native 802.11','Wireless LAN')
  }
  $ethernet=$network | Where-Object {$_.PhysicalMediaType -eq '802.3'} | Sort-Object { $_.Status -ne 'Up' } | Select-Object -First 1
  $wireless=$network | Where-Object {$_.PhysicalMediaType -ne '802.3'} | Sort-Object { $_.Status -ne 'Up' } | Select-Object -First 1
  $adapter=if($ethernet -and ($ethernet.Status -eq 'Up' -or !$wireless)){$ethernet}else{$wireless}
  $bluetooth=Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Where-Object {$_.InstanceId -match '^(USB|PCI|ACPI|UART)\\'} | Select-Object -First 1
  $theme=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
  $v=@{networkName=if($adapter -and $adapter.PhysicalMediaType -ne '802.3'){'Wi-Fi'}else{'Ethernet'};networkUp=($adapter.Status -eq 'Up');bluetooth=if(!$bluetooth){'missing'}elseif($bluetooth.Status -eq 'OK'){'available'}else{'disabled'};dark=($theme.AppsUseLightTheme -eq 0)}
}
'controls-theme' {
  $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  if(!(Test-Path $key)){New-Item $key -Force | Out-Null}
  $current=(Get-ItemProperty $key -ErrorAction SilentlyContinue).AppsUseLightTheme
  $next=if($current -eq 0){1}else{0}
  Set-ItemProperty -Path $key -Name AppsUseLightTheme -Value $next -Type DWord
  Set-ItemProperty -Path $key -Name SystemUsesLightTheme -Value $next -Type DWord
  [OrbitNative]::RefreshTheme()
  $v=@{dark=($next -eq 0)}
}
'power' {
  switch($r.command){
    'lock' {if(![OrbitNative]::LockWorkStation()){throw 'Windows не смогла заблокировать экран'}}
    'sleep' {if(![OrbitNative]::Sleep()){throw 'Режим сна недоступен'}}
    'restart' {& "$env:WINDIR\System32\shutdown.exe" /r /t 0 | Out-Null;if($LASTEXITCODE){throw 'Windows не приняла команду перезагрузки'}}
    'shutdown' {& "$env:WINDIR\System32\shutdown.exe" /s /t 0 | Out-Null;if($LASTEXITCODE){throw 'Windows не приняла команду выключения'}}
    default {throw 'Неизвестная команда питания'}
  }
  $v=$true
}
'happ-status' {
  $registered=Get-Item 'Registry::HKEY_CLASSES_ROOT\happ\shell\open\command' -ErrorAction SilentlyContinue
  $installed=$null -ne $registered -and $registered.GetValue('') -match '(?i)\bHapp\.exe\b'
  $tunnel=[Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object {
    $_.OperationalStatus -eq 'Up' -and ($_.Description -like 'Happ Tunnel*' -or $_.Name -in @('happ-xray','happ-tun'))
  } | Select-Object -First 1
  $v=@{installed=$installed;mode='off'}
  if($installed -and $tunnel){$v.mode='tun';$v.adapter=$tunnel.Description}
  elseif($installed -and (Get-Process Happ -ErrorAction SilentlyContinue)){
    $proxy=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if($proxy.ProxyEnable -eq 1 -and $proxy.ProxyServer -match '(?:127\.0\.0\.1|localhost):(\d+)'){
      $port=[int]$Matches[1]
      $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::')} | Select-Object -First 1
      $process=if($listener){Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue}
      if($process -and $process.Path -match '(?i)[\\/]Happ[\\/]'){$v.mode='proxy';$v.adapter='Прокси Windows'}
      elseif($process -and $process.ProcessName -in @('xray','happd','sing-box')){$v.mode='unknown'}
    }
  }
}
'audio' {
  if(-not ('OrbitAudio' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Audio.cs')}
  $v=[OrbitAudio]::Update([string]$r.command,[float]$r.level,[string]$r.endpoint)
}
'keyboard' {
  $v=@{}
  if($r.clipboard){$v.clipboardSequence=[OrbitNative]::GetClipboardSequenceNumber()}
  $id=[OrbitNative]::KeyboardLayout()
  if($id){
    $language=[int]($id -band 0xffff)
    try {$label=[Globalization.CultureInfo]::GetCultureInfo($language).TwoLetterISOLanguageName.ToUpperInvariant()}
    catch {$label='{0:X4}' -f $language}
    $v.id=[string]$id;$v.label=$label;$v.caps=[OrbitNative]::CapsLock()
  }
}
'status' {
[OrbitNative]::Watch([int]$r.own);$state=[OrbitNative]::State([int]$r.own);if(-not $state.own -and $state.handle -ne 0){$script:lastHandle=$state.handle}
$b=[OrbitNative]::Power()
$v=@{layout=$state.layout;caps=$state.caps;fullscreen=$state.full;battery=[int]$b.BatteryLifePercent;plugged=($b.ACLineStatus -eq 1);idleSeconds=[OrbitNative]::IdleSeconds()}
if(!$state.own -and $state.pid){$foreground=Get-Process -Id $state.pid -ErrorAction SilentlyContinue;$v.foreground=$foreground.ProcessName}
try {
  $mediaManager=Manager
  $current=$mediaManager.GetCurrentSession()
  $sessions=@()
  try {$sessions=@($mediaManager.GetSessions())}catch{}
  $v.sources=@($sessions | ForEach-Object {$_.SourceAppUserModelId} | Where-Object {$_} | Select-Object -Unique)
  if($current -and $current.SourceAppUserModelId -notin $v.sources){$v.sources+=@($current.SourceAppUserModelId)}
  $s=Select-Media $current $sessions $r.preferred $false
  if($s){
    $m=Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime])
    $p=$s.GetPlaybackInfo()
    $timeline=$s.GetTimelineProperties()
    $key=ConvertTo-Json -Compress -InputObject @($s.SourceAppUserModelId,$m.Title,$m.Artist,$m.AlbumTitle)
    if($key -ne $coverKey){$coverKey=$key;$cover=$null;$coverRevision++;$coverRetryAt=[datetime]::MinValue}
    if(!$cover -and [datetime]::UtcNow -ge $coverRetryAt){
      $coverRetryAt=[datetime]::UtcNow.AddSeconds(15)
      try {$cover=Read-Cover $m.Thumbnail;if($cover){$coverRevision++}}catch {$v.coverError=$_.Exception.Message}
    }
    $v.media=@{title=$m.Title;artist=$m.Artist;album=$m.AlbumTitle;source=$s.SourceAppUserModelId;playing=([int]$p.PlaybackStatus -eq 4);position=$timeline.Position.TotalSeconds;updatedAt=$timeline.LastUpdatedTime.ToUnixTimeMilliseconds();duration=$timeline.EndTime.TotalSeconds;coverRevision=$coverRevision}
    if($r.coverRevision -ne $coverRevision){$v.media.cover=$cover}
  } else {$coverKey=$null;$cover=$null}
} catch {$v.mediaError=$_.Exception.Message}
}
'media' {
  $mediaManager=Manager
  $sessions=@()
  try {$sessions=@($mediaManager.GetSessions())}catch{}
  $s=Select-Media ($mediaManager.GetCurrentSession()) $sessions $r.source $true
  if(!$s){throw 'Медиасессия закрыта. Запусти трек в плеере.'}
  switch($r.command){
    'play' {$op=$s.TryTogglePlayPauseAsync()}
    'next' {$op=$s.TrySkipNextAsync()}
    'previous' {$op=$s.TrySkipPreviousAsync()}
    default {throw 'Неизвестная команда плеера'}
  }
  $v=Await $op ([bool])
  if(!$v){throw 'Плеер отклонил команду'}
}
'volume' {if($r.command -eq 'up'){[OrbitNative]::Key(175)}elseif($r.command -eq 'down'){[OrbitNative]::Key(174)}else{[OrbitNative]::Key(173)};$v=$true}
'paste' {
  $script:lastHandle=[OrbitNative]::LastForeign
  if($script:lastHandle -ne 0){
    if(-not ('System.Windows.Forms.SendKeys' -as [type])){Add-Type -AssemblyName System.Windows.Forms}
    [OrbitNative]::SetForegroundWindow([IntPtr]$script:lastHandle)|Out-Null
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  }
  $v=$true
}
'dictation' {[OrbitNative]::keybd_event(91,0,0,[UIntPtr]::Zero);[OrbitNative]::Key(72);[OrbitNative]::keybd_event(91,0,2,[UIntPtr]::Zero);$v=$true}
'ocr' {
$file=Await ([Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync([string]$r.path)) ([Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode,Windows.Storage,ContentType=WindowsRuntime]::Read)) ([Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime])
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime])
$bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime])
$engine=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages();if(-not $engine){throw 'Установи язык распознавания в параметрах Windows'}
$result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]);$v=$result.Text;$stream.Dispose();$bitmap.Dispose()
}
default {throw 'Неизвестная команда Windows'}
}
@{id=$r.id;result=$v}|ConvertTo-Json -Depth 8 -Compress|ForEach-Object{[Console]::WriteLine($_)}
}catch{@{id=$r.id;error=$_.Exception.Message}|ConvertTo-Json -Compress|ForEach-Object{[Console]::WriteLine($_)}}
}
