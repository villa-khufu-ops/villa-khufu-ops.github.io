# Builds test pages: the real index.html with Firebase swapped for an in-memory fake (tests/mock.js).
import os, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here); out = os.path.join(here, 'site')
os.makedirs(out, exist_ok=True)
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
a = s.index('<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js">')
b = s.index('<script src="config.js"></script>') + len('<script src="config.js"></script>')
pages = {
  'admin.html': ('u1', "__DB.orders=Object.assign(__DB.orders||{},{tr1:{d:new Date().toISOString().slice(0,10),at:Date.now()-3600000,by:'r1',kind:'tour',room:'104',items:[],total:25,st:'new',paid:false,tour:{tr:1,car:'sedan',driver:null,date:new Date().toISOString().slice(0,10),time:'10:00',pax:2,from:'Hotel',to:'Airport'}}});"),
  'rec.html': ('r1', ''),
  'guest.html': ('', ''),
  'kitchen.html': ('u1', "__DB.geo=Object.assign(__DB.geo||{},{printer:{kit:'192.168.1.100'}});__DB.orders=Object.assign(__DB.orders||{},{ko1:{d:new Date().toISOString().slice(0,10),at:Date.now()-60000,by:'r1',dest:'table',table:'5',items:[{n:'Koshari',p:5,q:2}],total:12.77,st:'new',no:3,pay:'cash',paid:true}});__DB.prt={ko1:{st:'fail',at:Date.now()-50000,by:'r1',no:3,err:'x'}};"),
}
for f, (uid, extra) in pages.items():
    inj = '<script>window.__UID="%s";window.__PUSH=[];window.fetch=function(u,o){__PUSH.push(o&&o.body);return Promise.resolve({ok:true,json:function(){return Promise.resolve({})},text:function(){return Promise.resolve("")}});};</script><script src="mock.js"></script><script>%s</script>' % (uid, extra)
    open(os.path.join(out, f), 'w', encoding='utf-8').write(s[:a] + inj + s[b:])
import shutil
shutil.copy(os.path.join(here, 'mock.js'), out)
for x in ['logo.jpg', 'logo-bw.png', 'tours.jpg', 'icon-192.png', 'menu.pdf']:
    if os.path.exists(os.path.join(root, x)): shutil.copy(os.path.join(root, x), out)
print('built', len(pages), 'pages')
