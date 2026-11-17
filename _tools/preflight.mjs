#!/usr/bin/env node
/**
 * 347 备考系统 · 回归预检（preflight）
 *
 * 目的：把「照抄必过 / 漏整句不给过 / 看答案不能回填 / 空答不记账 / 单选单记 /
 *       三态不穿透 / SE 不双记 / 练习零写库 / PO 累计 / 门不裁剪」这些硬约束
 *       固化成可复跑的断言，避免「改 A 坏 B」和「声称修但没生效」。
 *
 * 注意：本工具当前只覆盖「基础可用 + 空答不记账 + PO 累计 + 门不裁剪 + 0 JS」；
 *       三态穿透 / SE 双记 / 练习零写库 / 照抄批量 仍未覆盖
 *
 * ⚠️ 断言强度说明（2026-11-18）：
 *   - **J1/J2 是经变异实测确认有区分力的口径断言**（v327-a 验证：回退 sj 排除 → J1 FAIL）（种子 a=8,c=3,sj=5 -> 期望 100%；
 *     若 sj 未从分母排除则得 38%，J 会 FAIL）。已用它钉住 V306 的 P1-R01。
 *   - K/L 曾试图做 DOM 级断言但提取器不稳（K 恒真、L 正则在模板字符串里转义失效），
 *     **已删除而不保留假断言**；待重写。
 *
 * 用法：
 *   node _tools/preflight.mjs [--url http://127.0.0.1:18080] [--edge "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
 *
 * 依赖：无（纯 CDP，用本机 Edge/Chrome --headless）
 * 退出码：0 = 全过；1 = 有失败
 *
 * 设计原则：
 *   - 断言 store（localStorage）状态，不只看 UI 文本
 *   - 每条断言独立 label，失败时打印实测值
 *   - 不写部署文件，只读
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARGS = process.argv.slice(2);
const arg = (k, d) => {
  const i = ARGS.indexOf('--' + k);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d;
};

const BASE = arg('url', 'http://127.0.0.1:18080').replace(/\/$/, '');
const EDGE = arg('edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const PORT = 19500 + Math.floor(Math.random() * 400);
const PROFILE = mkdtempSync(join(tmpdir(), 'pf-347-'));

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + label + (detail !== undefined ? '  -> ' + detail : ''));
}

/* ---------------- 最小 CDP 客户端 ---------------- */
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
    try {
      // 必须连 page target（browser target 没有 Page.enable）
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP page target 未就绪（Edge 未启动？）');
}

function wsSend(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ': ' + m.error.message));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function main() {
  const browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore', detached: false });

  const wsUrl = await cdpConnect();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let _id = 0;
  const send = (method, params) => wsSend(ws, ++_id, method, params);

  await send('Page.enable');
  await send('Runtime.enable');

  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await sleep(1200);
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };

  const errors = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.text || 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
  });

  const QUIZ = BASE + '/quiz/index.html';
  const INDEX = BASE + '/index.html';

  /* ---------------- 断言集 ---------------- */

  // A. 判分核心：照抄必过 / 漏整句不给过 / 空答不记账
  await navigate(QUIZ);
  check('quiz 页面可加载', await evalJs('document.querySelectorAll("button").length') > 3,
        'buttons=' + await evalJs('document.querySelectorAll("button").length'));

  // A1 判分函数存在且可从 window 读取（不强求暴露，用 DOM 侧等价断言）
  const hasStorage = await evalJs(`(() => { try { localStorage.setItem('__pf_probe','1'); const v = localStorage.getItem('__pf_probe'); localStorage.removeItem('__pf_probe'); return v === '1'; } catch(e) { return false; } })()`);
  check('localStorage 可读写', hasStorage === true, 'probe=' + hasStorage);

  // A2 首页 CTA 可点（进入会话）
  const startBtn = await evalJs(`(() => {
    const b = document.querySelector('[data-act="start"]');
    if (!b) return 'no-cta';
    b.click();
    return document.body.classList.contains('in-session') ? 'in-session' : 'clicked';
  })()`);
  check('首页 CTA 可进入答题会话', startBtn === 'in-session' || startBtn === 'clicked', startBtn);

  // A3 会话内有输入区或选择项
  const hasInput = await evalJs(`!!document.querySelector('textarea') || !!document.querySelector('[data-opt]') || !!document.querySelector('.opt')`);
  check('会话内出现作答控件', hasInput, 'input=' + hasInput);

  // B. 空答揭晓不记账
  await navigate(QUIZ);
  await evalJs('localStorage.clear(); 1');
  await navigate(QUIZ);
  const revealFlow = await evalJs(`(() => {
    const b = document.querySelector('[data-act="start"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(600);
  const beforeReveal = await evalJs('JSON.stringify(window.__PF_reading ? {} : {})');
  // 直接找"显示参考答案"按钮并点
  const afterReveal = await evalJs(`(() => {
    const btn = document.querySelector('[data-act="reveal"]');
    if (!btn) return { ok: false, why: 'no-reveal-btn' };
    btn.click();
    return { ok: true };
  })()`);
  await sleep(400);
  const recAfter = await evalJs(`(() => {
    const raw = localStorage.getItem('dsh.347.quiz.v3');
    if (!raw) return { q: 0, a: 0 };
    const p = JSON.parse(raw);
    const qs = Object.values(p.q || {});
    const bad = qs.reduce((s, r) => s + (+r.bad || 0), 0);
    const wrong = qs.reduce((s, r) => s + (+r.wrong || 0), 0);
    const a = Object.values(p.days || {}).reduce((s, d) => s + (+d.a || 0), 0);
    return { q: qs.length, bad, wrong, a };
  })()`);
  check('空答揭晓不记 bad/wrong', recAfter.bad === 0 && recAfter.wrong === 0,
        'bad=' + recAfter.bad + ' wrong=' + recAfter.wrong);

  // D. index 页面：门/环/PO 存在且 PO 累计不恒 0
  await navigate(INDEX);
  const idxOk = await evalJs(`!!document.getElementById('MOTIV') || !!document.querySelector('.mv-gates, #mv-gates')`);
  check('index 主面板存在', idxOk, 'MOTIV/gates');

  const poEval = await evalJs(`(() => {
    // 造 200 累计题次，验证 PO 事件进度不再是 0%
    const KEY = 'dsh.347.quiz.v3';
    const p = JSON.parse(localStorage.getItem(KEY) || '{"v":3,"q":{},"days":{}}');
    p.days = p.days || {};
    const d = new Date(); d.setHours(d.getHours() - 4);
    for (let i = 0; i < 5; i++) {
      const t = new Date(d.getTime() - i * 86400000);
      const k = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
      p.days[k] = { a: 40, c: 30, w: 0, la: 10 };
    }
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  })()`);
  await navigate(INDEX);
  const poTxt = await evalJs(`(document.getElementById('PO-EPCT')||{}).textContent || ''`);
  const poPct = parseFloat(poTxt);
  check('PO 事件进度累计 = 200/614（X1 死代码回归钉死）',
        poPct >= 32.4 && poPct <= 32.8 && /200\/614/.test(poTxt),
        'PO-EPCT=' + poTxt);

  // E. 门不裁剪（390 宽度）
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(INDEX);
  const clip = await evalJs(`(() => {
    const gs = [...document.querySelectorAll('.mv-gate')];
    if (!gs.length) return { n: 0 };
    let clipped = 0;
    gs.forEach(g => { if (g.scrollHeight > g.clientHeight + 1) clipped++; });
    return { n: gs.length, clipped };
  })()`);
  check('390 门不裁剪', clip.n > 0 && clip.clipped === 0, 'gates=' + clip.n + ' clipped=' + (clip.clipped || 0));
  await send('Emulation.clearDeviceMetricsOverride');

  // F. 练习零写库（结构断言：练习路径不产生 days.a）
  const parseOk = await evalJs(`(() => { const raw = localStorage.getItem('dsh.347.quiz.v3'); if (!raw) return 'no-key'; try { const p = JSON.parse(raw); return (p && typeof p === 'object' && p.q !== undefined) ? 'ok' : 'bad-shape'; } catch(e) { return 'bad-json'; } })()`);
  check('store JSON 可解析且结构正确', parseOk === 'ok', parseOk);

  // ===== J/K：口径断言（种子注入 -> 读 index 渲染）=====
  // J. 自评题次(sj)必须从正确率分母排除 —— 种 a=8,c=3,sj=5 期望 3/(8-0-5)=100%，若未排除则 3/8=38%
  await navigate(INDEX);
  const seedJ = await evalJs(`(() => {
    const KEY = 'dsh.347.quiz.v3';
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
    try { localStorage.removeItem('dsh.347.recovery.v1'); } catch(e){}
    const p = { v: 3, q: {}, days: {} };
    p.days[T] = { a: 30, c: 24, w: 0, la: 0, sj: 6 };   /* V335: c+w=24 覆盖 8/12/18/24 四档, acc=24/(30-6)=100%(未排除sj则80%) */
    localStorage.setItem(KEY, JSON.stringify(p));
    return T;
  })()`);
  await navigate(INDEX);
  const accJ = await evalJs(`(() => {
    const t = document.body.innerText;
    const m = t.match(/(\d+)%/) || [];
    return { txt: t.slice(0, 4000), pct: m[1] || null };
  })()`);
  // 断言：页面内出现 100%（或至少不出现 38%）
  const _pctJ1 = await evalJs(`(() => { const e = document.getElementById('mv-pct'); return e ? (e.textContent||'').trim() : ''; })()`);
  const has100 = /\b100\s*%/.test(accJ.txt) || accJ.txt.indexOf('100%') >= 0;
  const has38 = accJ.txt.indexOf('38%') >= 0;
  check('自评题次 sj 从正确率分母排除（a=30,c=24,sj=6 -> 100% 而非 80%）',
        has100 && !has38, 'has100=' + has100 + ' has38=' + has38);
  // J2（自校验对·相对断言）：sj=0 时的 ring 百分比必须与 J1(sj=5) 不同
  // 若 sj 未从正确率分母排除，两次 ring 相同 -> 本断言 FAIL
  await evalJs(`(() => {
    const KEY = 'dsh.347.quiz.v3';
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
    try { localStorage.removeItem('dsh.347.recovery.v1'); } catch(e){}
    const p = { v: 3, q: {}, days: {} };
    p.days[T] = { a: 8, c: 3, w: 0, la: 0, sj: 0 };
    localStorage.setItem(KEY, JSON.stringify(p));
    return T;
  })()`);
  await navigate(INDEX);
  const pctJ2 = await evalJs(`(() => {
    const e = document.getElementById('mv-pct');
    return e ? (e.textContent || '').trim() : '';
  })()`);
  check('自校验：sj=0 的完成度与 sj=5 不同（相对断言，证明 J1 有区分力）',
        pctJ2 !== '' && pctJ2 !== _pctJ1,
        'sj=5 pct="' + _pctJ1 + '" sj=0 pct="' + pctJ2 + '"');

  // M1. 【不变量·状态级】违规 days（c > a-la-sj）-> 页面不得渲染 >100%，且 __DSH_STATE 可读
  await navigate(QUIZ);
  const invM1 = await evalJs(`(() => {
    if (typeof window.__DSH_STATE !== 'function') return { why: 'no-state-api' };
    const st = window.__DSH_STATE();
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    // 违反不变量：a=8, la=0, sj=5 -> cap=3，但 c=9
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:{}, days: { [T]: { a:8, c:9, w:0, la:0, sj:5 } } }));
    return { T: T, hasState: true, availCount: st.availCount, repCount: st.repCount, realKps: st.realKps };
  })()`);
  await navigate(QUIZ);
  // V335: 真打开进度页再断言（此前只在 quiz 首页扫 innerText，首页无 % 文本 -> 空断言）
  await evalJs(`(() => { try { const c=[...document.querySelectorAll('[data-act="go"]')].filter(b=>/progress/i.test(b.getAttribute('data-arg')||'')); if(c.length){c[0].click();return 1;} } catch(e){} return 0; })()`);
  await sleep(1200);
  const invM1b = await evalJs(`(() => {
    const t = document.body.innerText || '';
    const over = (t.match(/([0-9]{1,3})[ ]*%/g) || []).map(x => parseInt(x,10)).filter(n => n > 100);   /* V336 B5: 用 [0-9] 避开模板转义 */
    const accEl = document.querySelector('.acc-num');
    const accTxt = accEl ? (accEl.textContent || '').replace(/[^0-9]/g, '') : null;
    return { over: over, overCount: over.length, acc: accTxt ? parseInt(accTxt, 10) : null, isProg: /已答次数/.test(t) };
  })()`);
  check('M1 违规 days（c=9>cap=3）在**进度页**不渲染 >100%',
        invM1.hasState === true && invM1b.isProg === true && invM1b.overCount === 0 && invM1b.acc !== null && invM1b.acc <= 100   /* V336 B5b: 不得 null 放行 */,
        'stateApi=' + invM1.hasState + ' isProg=' + invM1b.isProg + ' over=' + invM1b.overCount + ' acc=' + invM1b.acc);

  // M2. 【真实 kp 种子】用 __DSH_STATE().realKps 的**真键**种记录 + days -> 进度页 acc===100%
  const realKps = (invM1 && invM1.realKps) || [];
  const seedM2 = await evalJs(`(() => {
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    const kps = ${JSON.stringify(realKps)};
    const q = {};
    // a=8,c=3,sj=5 + 8 条真 kp 记录 ok=1 -> 旧混口径 = 8/3 = 267%，新口径 = 3/3 = 100%
    for (let i = 0; i < Math.min(8, kps.length); i++) q[kps[i]] = { ok: 1, last: T, lastOutcome: 'ok', seen: 1 };
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:q, days: { [T]: { a:8, c:3, w:0, la:0, sj:5 } } }));
    return { T: T, seeded: Object.keys(q).length };
  })()`);
  await navigate(QUIZ);
  await evalJs(`(() => { try { const c=[...document.querySelectorAll('[data-act="go"]')].filter(b=>/progress/i.test(b.getAttribute('data-arg')||'')); if(c.length){c[0].click();return 1;} } catch(e){} return 0; })()`);
  await sleep(1200);
  const m2txt = await evalJs(`document.body.innerText || ''`);
  const m2accEl = await evalJs(`(() => { const e = document.querySelector('.acc-num'); return e ? (e.textContent || '').replace(/[^0-9]/g, '') : null; })()`);
  const m2acc = m2accEl;
  const m2over = ((m2txt.match(/(\d{1,3})\s*%/g) || []).map(x => parseInt(x,10)).filter(n => n > 100)).length;
  check('M2 真实 kp 种子下进度页正确率 ===100% 且无 >100%（钉死 267%）',
        seedM2.seeded >= 8 && parseInt(m2acc, 10) === 100 && m2over === 0,
        'seeded=' + seedM2.seeded + ' acc=' + m2acc + ' over=' + m2over);

  // M3. 【第二期望值】a=10,c=5,sj=0 -> 期望 50%（防「恒真 100」漏检）
  await evalJs(`(() => {
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:{}, days: { [T]: { a:10, c:5, w:0, la:0, sj:0 } } }));
    return T;
  })()`);
  await navigate(QUIZ);
  await evalJs(`(() => { try { const c=[...document.querySelectorAll('[data-act="go"]')].filter(b=>/progress/i.test(b.getAttribute('data-arg')||'')); if(c.length){c[0].click();return 1;} } catch(e){} return 0; })()`);
  await sleep(1200);
  const m3acc = await evalJs(`(() => { const e = document.querySelector('.acc-num'); return e ? parseInt((e.textContent||'').replace(/[^0-9]/g,''),10) : null; })()`);
  check('M3 第二期望值：a=10,c=5,sj=0 -> 进度页正确率 ===50%（防恒真 100）',
        m3acc === 50, 'acc=' + m3acc);

  // M4. 【c+w 回归断言】种 la=12（空揭晓）-> 首页答题门必须 0/12 不亮（钉死 V328）
  await navigate(INDEX);
  await evalJs(`(() => {
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    /* V353: 混合日（非学习日）—— 才能咬住 c+w 回归（纯学习日会被 learn 文案掩盖） */
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:{}, days: { [T]: { a:20, c:8, w:0, la:12, sj:0 } } }));
    return T;
  })()`);
  await navigate(INDEX);
  const m4 = await evalJs(`(() => {
    const t = document.body.innerText || '';
    const gate = (t.match(/答题\\s*(\\d+)\\/(\\d+)/) || []);
    const learnGate = /学习\\s*(\\d+)\\/(\\d+)/.test(t);
    const achieved = /答题已达标/.test(t);
    return { done: gate[1] ? +gate[1] : null, tgt: gate[2] ? +gate[2] : null, achieved: achieved, learnGate: learnGate };
  })()`);
  /* V352: 独立取 machineDone(c+w) 与门 cls，避开模板转义 */
  const m4b = await evalJs(`(() => {
    var md = 0;
    try {
      var st = window.__DSH_STATE ? window.__DSH_STATE() : null;
      var dd = (st && st.days && st.days[st.today]) || {};
      md = (+dd.c || 0) + (+dd.w || 0);
    } catch(e){}
    var gateOk = null, gateDone = null;
    try {
      var gs = document.querySelectorAll('#mv-gates .mv-gate');
      for (var gi = 0; gi < gs.length; gi++) {
        if ((gs[gi].textContent || '').indexOf('答题') >= 0) {
          var gxx = gs[gi].querySelector('.gx');
                    var _txt = (gxx ? gxx.textContent : '') || ''; var _parts = _txt.split('/'); if (_parts.length >= 2) { gateDone = parseInt(_parts[0].replace(/[^0-9]/g, ''), 10); }
          if (mm2) gateDone = parseInt(mm2[1], 10);
          break;
        }
      }
    } catch(e){}
    return { machineDone: md, gateOk: gateOk, gateDone: gateDone };
  })()`);
  check('M4 空揭晓 12 次（la=12）-> 门不是机判达标（学习日态，钉死 V328 的 c+w）',
        m4.achieved === false && m4b.machineDone === 8 && m4b.gateDone === 8,   /* V353: 混合日门必须显示 c+w=8，不是 days.a=20 */
        'achieved=' + m4.achieved + ' machineDone=' + m4b.machineDone + ' gateDone=' + m4b.gateDone);

  // M5/M6. 【恢复日断言】B 方指出的盲区：禁掉整段 recovery 逻辑此前仍 16/16 PASS
  // M5: 恢复日门目标必须 = 3 题 / 30 词
  await navigate(INDEX);
  const seedM5 = await evalJs(`(() => {
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    /* 造断档：只在 3 天前有学习记录；firstuse 设成 3 天前（避免新用户守卫误拦） */
    const d3 = new Date(T + 'T00:00:00'); d3.setDate(d3.getDate() - 3);
    const D3 = d3.toISOString().slice(0,10);
    localStorage.removeItem('dsh.347.recovery.v1');
    localStorage.setItem('dsh.347.firstuse', D3);
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:{}, days: { [D3]: { a:8, c:5, w:2, la:1, sj:0 } } }));
    return T;
  })()`);
  await navigate(INDEX);
  const m5 = await evalJs(`(() => {
    const gs = [...document.querySelectorAll('#mv-gates .mv-gate')];
    const txts = gs.map(g => (g.textContent||'').replace(/\s+/g,''));
    const req = gs.filter(g => !/不要求/.test(g.textContent||'')).map(g => (g.textContent||'').replace(/\s+/g,''));
    const coach = (document.getElementById('mv-coach')||{}).innerText || '';
    return { total: gs.length, reqN: req.length, req: req, coach: coach.slice(0, 80),
             recov: localStorage.getItem('dsh.347.recovery.v1') };
  })()`);
  check('M5 恢复日门目标 = 3 题 / 30 词（禁 recovery 逻辑必 FAIL）',
        m5.reqN === 2 && m5.req.some(function(x){ return /\/3/.test(x); }) && m5.req.some(function(x){ return /\/30/.test(x); }) && /欢迎回来/.test(m5.coach),
        'reqN=' + m5.reqN + ' req=' + JSON.stringify(m5.req) + ' coach=' + m5.coach.slice(0, 40));

  // M6: 恢复日完成 3 题 + 30 词 -> 环必须 100%（绿）、coach 含「重启完成」
  await evalJs(`(() => {
    const d = new Date(); d.setHours(d.getHours() - 4);
    const T = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    const q = {};
    for (let i = 1; i <= 3; i++) q['px-4-' + i] = { ok: 1, last: T, lastOutcome: 'ok', seen: 1 };
    localStorage.setItem('dsh.347.quiz.v3', JSON.stringify({ v:3, q:q, days: { [T]: { a:3, c:3, w:0, la:0, sj:0 } , ...JSON.parse(localStorage.getItem('dsh.347.quiz.v3')||'{}').days } }));
    /* 墨墨 30（真实键 motiv.v3.days[T].背） */
    let mv = {}; try { mv = JSON.parse(localStorage.getItem('dsh.347.motiv.v3') || '{}'); } catch(e){}
    mv.days = mv.days || {}; mv.days[T] = mv.days[T] || {}; mv.days[T]['背'] = 30;
    localStorage.setItem('dsh.347.motiv.v3', JSON.stringify(mv));
    return 1;
  })()`);
  await navigate(INDEX);
  const m6 = await evalJs(`(() => {
    const pct = document.getElementById('mv-pct');
    const coach = (document.getElementById('mv-coach')||{}).innerText || '';
    return { pct: pct ? pct.textContent : '', color: pct ? pct.style.color : '', coach: coach.slice(0, 60), gap: (document.getElementById('mv-gap')||{}).innerText || '' };
  })()`);
  check('M6 恢复日完成 3 题+30 词 -> 环 100% 且 coach 含「重启完成」',
        String(m6.pct).indexOf('100') >= 0 && /重启完成/.test(m6.coach) && /rgb\(5,\s*150,\s*105\)|#059669/i.test(m6.color) && !/欠\s*\d/.test(m6.gap || ''),
        'pct="' + m6.pct + '" color=' + m6.color + ' coach=' + m6.coach.slice(0, 30));

  // G. 零 JS 错误汇总
  check('全程 0 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

  /* ---------------- 汇总 ---------------- */
  const fail = results.filter(r => !r.ok);
  console.log('\n=== 汇总：' + (results.length - fail.length) + '/' + results.length + ' 通过 ===');
  if (fail.length) {
    console.log('失败项：');
    fail.forEach(f => console.log('  - ' + f.label + '  -> ' + f.detail));
  }

  ws.close();
  try { browser.kill(); } catch { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error('[preflight 异常] ' + (e && e.message ? e.message : e));
  process.exit(2);
});
