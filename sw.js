const CACHE_NAME = 'pbx-v3';
const ASSETS = [
  'index.html',
  'manifest.json',
  'sw.js',
  'app-icon-192.png',
  'app-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  // Start alarm check timer in Service Worker
  startAlarmChecker();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then(cached => {
        if (cached) return cached;
        return fetch(event.request);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      
      return cached || fetchPromise;
    })
  );
});

// === Alarm Checker in Service Worker ===
// This runs independently of the page, so alarms can fire even when page is hidden
let alarmCheckTimer = null;
let lastCheckMinute = -1;

function startAlarmChecker(){
  if(alarmCheckTimer) return;
  // Check every 15 seconds - frequent enough to catch minute changes
  alarmCheckTimer = setInterval(checkAlarmsInSW, 15000);
  checkAlarmsInSW(); // Check immediately on start
}

function checkAlarmsInSW(){
  const now = new Date();
  const curHour = now.getHours();
  const curMin = now.getMinutes();
  const curDay = now.getDay() || 7;
  const curMinuteKey = `${curHour}:${curMin}`;
  
  // Skip if already checked this exact minute
  if(curMinuteKey === lastCheckMinute) return;
  lastCheckMinute = curMinuteKey;
  
  // Read alarms from a dedicated SW-synced storage
  // Since SW can't access localStorage, we use a message-based approach
  // The page periodically syncs alarm data to SW via postMessage
  const alarmData = self._swAlarms || [];
  const todayStr = formatDate(now);
  
  alarmData.forEach(a=>{
    if(!a.enabled) return;
    if(a.hour !== curHour || a.minute !== curMin) return;
    
    const triggerKey = `${curHour}:${curMin}:${todayStr}`;
    if(a.triggered && a.triggered.includes(triggerKey)) return;
    
    // Check repeat rules
    let shouldFire = false;
    if(a.repeat === 'once') shouldFire = true;
    else if(a.repeat === 'daily') shouldFire = true;
    else if(a.repeat === 'weekly' && a.weekDays && a.weekDays.includes(curDay)) shouldFire = true;
    else if(a.repeat === 'workday' && curDay >= 1 && curDay <= 5) shouldFire = true;
    
    if(shouldFire){
      fireAlarmNotification(a);
      // Mark as triggered
      a.triggered.push(triggerKey);
      if(a.repeat === 'once') a.enabled = false;
    }
  });
  
  // Sync triggered state back to page
  self._swAlarms = alarmData;
}

function fireAlarmNotification(a){
  self.registration.showNotification(`⏰ PBX提醒: ${a.name}`, {
    body: `${String(a.hour).padStart(2,'0')}:${String(a.minute).padStart(2,'0')}${a.note ? ' - '+a.note : ''}`,
    tag: 'pbx-alarm-' + a.id,
    requireInteraction: true,
    icon: 'app-icon-192.png',
    vibrate: [200, 100, 200, 100, 200, 100, 200],
    data: { alarmId: a.id, url: self.registration.scope }
  });
}

function formatDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Receive alarm data from page
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SYNC_ALARMS'){
    self._swAlarms = event.data.alarms;
  }
});

// When user clicks the notification, open/focus the app page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const alarmId = event.notification.data && event.notification.data.alarmId;
  
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(clientList => {
      // If app is already open, focus it and send alarm info
      for(const client of clientList){
        if(client.url.includes('index.html') && 'focus' in client){
          client.postMessage({type:'ALARM_CLICKED', alarmId: alarmId});
          return client.focus();
        }
      }
      // If not open, open it
      return self.clients.openWindow('index.html');
    })
  );
});
