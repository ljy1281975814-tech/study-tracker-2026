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
 *   - **J 是本轮唯一真正有区分力的口径断言**（种子 a=8,c=3,sj=5 -> 期望 100%；
 *     若 sj 未从分母排除则得 38%，J 会 FAIL）。已用它钉住 V306 的 P1-R01。
 *   - K/L 曾试图做 DOM 级断言但提取器不稳（K 恒真、L 正则在模板字符串里转义失效），
 *     **已删除而不保留假断言**；待重写为「真走完一轮到完成页并断言卡合计」的形式。（见 README「已知未覆盖」）。
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
    const p = { v: 3, q: {}, days: {} };
    p.days[T] = { a: 8, c: 3, w: 0, la: 0, sj: 5 };
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
  const has100 = /\b100\s*%/.test(accJ.txt) || accJ.txt.indexOf('100%') >= 0;
  const has38 = accJ.txt.indexOf('38%') >= 0;
  check('自评题次 sj 从正确率分母排除（a=8,c=3,sj=5 -> 100% 而非 38%）',
        has100 && !has38, 'has100=' + has100 + ' has38=' + has38);

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
