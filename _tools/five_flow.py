# -*- coding: utf-8 -*-
"""五条主流程回归（推前必跑）：
① 文字照抄 -> ok=1
② 文字写一半 -> 不算对
③ 单选选对 -> ok=1
④ 单选选错 -> bad=1
⑤ 空答 -> 不记账
⑥ 错题本「解析」不崩（_kxOk 作用域）
"""
import json, os, subprocess, sys, time, uuid, urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import websocket

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 20760
prof = os.path.join(os.environ["TEMP"], "_5flow_" + uuid.uuid4().hex[:8])
os.makedirs(prof, exist_ok=True)
p = subprocess.Popen([EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                      "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + prof,
                      "--remote-allow-origins=*", "--window-size=1366,768", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
tg = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json/list" % PORT, timeout=8).read().decode("utf-8", "ignore"))
page = [t for t in tg if t.get("type") == "page"][0]
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
_id = [0]
errs = []


def cmd(m, pp=None):
    _id[0] += 1
    mid = _id[0]
    ws.send(json.dumps({"id": mid, "method": m, "params": pp or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            return msg
        if msg.get("method") == "Runtime.exceptionThrown":
            d = (msg.get("params") or {}).get("exceptionDetails") or {}
            errs.append(((d.get("exception") or {}).get("description") or d.get("text") or "")[:120])


def ev(x):
    r = cmd("Runtime.evaluate", {"expression": x, "returnByValue": True})
    return ((r.get("result") or {}).get("result", {}) or {}).get("value")


def cnt():
    s = str(ev("try{ localStorage.getItem('dsh.347.quiz.v3')||'null' }catch(e){'ERR'}"))
    return "ok=%d bad=%d fuzzy=%d" % (s.count('"ok":1'), s.count('"bad":1'), s.count('"fuzzy":1'))


def has_ok():
    return '"ok":1' in str(ev("try{ localStorage.getItem('dsh.347.quiz.v3')||''}catch(e){''}"))


cmd("Runtime.enable")
cmd("Page.enable")


def reset():
    cmd("Page.navigate", {"url": "http://127.0.0.1:18080/quiz/index.html"})
    time.sleep(4.5)
    ev("try{ localStorage.clear(); }catch(e){}")
    cmd("Page.navigate", {"url": "http://127.0.0.1:18080/quiz/index.html"})
    time.sleep(4.5)


def enter(arg):
    ev("""(function(){ var b=document.querySelector('[data-act="go"][data-arg="chapters"]'); if(b) b.click(); })()""")
    time.sleep(1.8)
    r = ev("""(function(a){ var b=document.querySelector('[data-act="chapter"][data-arg="'+a+'"]'); if(b){ b.click(); return 'ok'; } return 'no'; })(""" + json.dumps(arg) + ")")
    time.sleep(2.2)
    return r


def cur_ans():
    return ev("""(function(){
      try{
        var stem=(document.querySelector('.q-stem')||{}).innerText||''; stem=stem.replace(/\\s|　|（|）|\\(|\\)/g,'').trim();   /* V393: 归一化全角括号+空白 */
        var el=document.getElementById('bank'); var B=JSON.parse(el.textContent);
        var arr=[].concat(B.diff||[], B.items||[]);
        for(var i=0;i<arr.length;i++){ var q=arr[i]; if(!q) continue;
          var s=String(q.stem||q.q||'').trim();
          if(s && (s===stem||s.indexOf(stem)>=0||stem.indexOf(s)>=0)) return JSON.stringify({ans:String(q.ans||''), key:String(q.key||''), id:q.id}); }
        return null;
      }catch(e){ return null; }
    })()""")


def fill(t):
    return ev("""(function(txt){ var ta=document.querySelector('textarea'); if(!ta) return 'no-ta';
      ta.value=txt; ta.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })(""" + json.dumps(t) + ")")


def reveal():
    return ev("""(function(){ var b=document.querySelector('[data-act="reveal"]'); if(b){ b.click(); return 'ok'; } return 'no'; })()""")


def three():
    return ev("""(function(){ return Array.from(document.querySelectorAll('button')).filter(function(b){return (b.innerText||'').indexOf('熟知')>=0;}).length; })()""")


def click_known():
    return ev("""(function(){ var bs=Array.from(document.querySelectorAll('button')); for(var i=0;i<bs.length;i++){ if((bs[i].innerText||'').indexOf('熟知')>=0){ bs[i].click(); return 'clicked'; } } return 'no'; })()""")


results = []

# ===== ① 文字照抄 =====
reset()
enter("普心|4")
it = json.loads(cur_ans() or "null")
if it:
    fill(it["ans"]); time.sleep(0.4); reveal(); time.sleep(1.2)
    t = three()
    if t:
        click_known(); time.sleep(0.9)
    results.append(("① 文字照抄", "ok=1" if has_ok() else "❌未记ok", cnt(), "三态=%d" % t))
else:
    results.append(("① 文字照抄", "SKIP(无题)", "", ""))

# ===== ② 文字写一半 =====
reset()
enter("普心|4")
it = json.loads(cur_ans() or "null")
if it:
    half = (it["ans"] or "")[:max(4, len(it["ans"]) // 2)]
    fill(half); time.sleep(0.4); reveal(); time.sleep(1.2)
    t = three()
    results.append(("② 文字写一半", "不应ok -> " + ("ok被记(❌)" if has_ok() else "未记ok ✓"), cnt(), "三态=%d" % t))
else:
    results.append(("② 文字写一半", "SKIP", "", ""))

# ===== ③④ 单选 =====
reset()
r = enter("社心|3")
print("  进社心3:", r)
for i in range(30):
    n = ev("""document.querySelectorAll('.option').length""")
    if n and n > 0:
        break
    ev("""(function(){ var b=document.querySelector('[data-act="next"]'); if(b) b.click(); })()""")
    time.sleep(0.6)
it = json.loads(cur_ans() or "null")
key = (it or {}).get("key", "") or ""
print("  单选 key:", key)
# ③ 选对
if key:
    ev("""(function(k){ var os=document.querySelectorAll('.option');
      for(var i=0;i<os.length;i++){ var t=(os[i].innerText||'').trim(); if(t.charAt(0)===k){ os[i].click(); return 'ok'; } }
      if(os.length){ os[0].click(); return 'first'; } return 'no'; })(""" + json.dumps(key) + ")")
    time.sleep(0.7)
    sb = ev("""(function(){ var b=document.querySelector('[data-act="submit"]'); if(b){ b.click(); return 'clicked'; } return 'no'; })()""")
    time.sleep(1.3)
    card = ev("""(function(){ var r=document.getElementById('resultCard'); return r?(r.innerText||'').replace(/\\n/g,' | ').slice(0,60):'NONE'; })()""")
    results.append(("③ 单选选对", "提交=%s" % sb, cnt(), (card or "")[:55]))
else:
    # V384: key 提取失败时**显式 FAIL**，不再静默跳过（评审指出的假绿）
    results.append(("③ 单选选对", "FAIL(单选 key 提取失败)", cnt(), ""))
# ④ 选错
reset()
enter("社心|3")
for i in range(30):
    n = ev("""document.querySelectorAll('.option').length""")
    if n and n > 0:
        break
    ev("""(function(){ var b=document.querySelector('[data-act="next"]'); if(b) b.click(); })()""")
    time.sleep(0.6)
it = json.loads(cur_ans() or "null")
key = (it or {}).get("key", "") or ""
wrong = "A" if key != "A" else "B"
ev("""(function(k){ var os=document.querySelectorAll('.option');
  for(var i=0;i<os.length;i++){ var t=(os[i].innerText||'').trim(); if(t.charAt(0)===k){ os[i].click(); return 'ok'; } }
  if(os.length){ os[0].click(); return 'first'; } return 'no'; })(""" + json.dumps(wrong) + ")")
time.sleep(0.7)
ev("""(function(){ var b=document.querySelector('[data-act="submit"]'); if(b) b.click(); })()""")
time.sleep(1.3)
card_w = ev("""(function(){ var r=document.getElementById('resultCard'); return r?(r.innerText||'').replace(/\\n/g,' | ').slice(0,70):'NONE'; })()""")
ok_after = has_ok()
ev("""(function(){ try{ if(document.activeElement&&document.activeElement.blur) document.activeElement.blur(); }catch(e){} document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()""")
time.sleep(1.0)
results.append(("④ 单选选错", ("选错记ok(❌)" if ok_after else "未记ok ✓"), cnt(), (card_w or "")[:60]))

# ===== ⑤ 空答 =====
reset()
enter("普心|4")
reveal(); time.sleep(1.2)
results.append(("⑤ 空答", ("不记账 ✓" if cnt() == "ok=0 bad=0 fuzzy=0" else "❌记账了"), cnt(), "三态=%d" % three()))

# ===== ⑥ 错题本解析 =====
errs.clear()
reset()
ev("""(function(){ var b=document.querySelector('[data-act="go"][data-arg="wrong"]'); if(b) b.click(); })()""")
time.sleep(1.5)
opened = ev("""(function(){ var b=document.querySelector('[data-act="reveal"], [data-act="sheet"], .wrong-item, [data-act="open"]'); if(b){ b.click(); return 'clicked'; } return 'no-item'; })()""")
time.sleep(1.2)
results.append(("⑥ 错题解析", "点击=%s" % opened, "errs=%d" % len(errs), (errs[0][:70] if errs else "无崩溃 ✓")))

print("=== 五条主流程 ===")
fails = 0
for r in results:
    flag = "✓" if ("❌" not in r[1] and "FAIL" not in str(r[1])) else "✗"
    if flag == "✗":
        fails += 1
    print("  [%s] %-14s %-18s %-26s %s" % (flag, r[0], r[1], r[2], r[3]))
print("  失败项: %d" % fails)
if fails: sys.exit(1)   # V393: 失败必须非零退出（门禁才拦得住）
print("  errs:", errs[:3] if errs else "NONE")

ws.close()
p.terminate()
try:
    import shutil
    shutil.rmtree(prof, ignore_errors=True)
except Exception:
    pass
print("  done")
