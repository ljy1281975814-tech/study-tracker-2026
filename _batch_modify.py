import re

html = open("index.html", encoding="utf-8").read()

# ============================================================
# 一、状态简化：取消"未汇报"中间态
# ============================================================
old_hint = 'timelineHint: "点击 ○ 标记完成 · 已过时段自动标灰 · 日课不挪 · 留白必留"'
new_hint = 'timelineHint: "当天未汇报 = 默认未完成 · 点击 ○ 标记已完成 · 已过时段未报=未完成 · 日课不挪 · 留白必留"'
html = html.replace(old_hint, new_hint, 1)

old_status = 'let statusIcon = done ? "✓" : (skipped ? "⊘" : (past && !done && !skipped ? "·" : "○"));'
new_status = 'let statusIcon = done ? "✓" : (skipped ? "⊘" : "○");'
html = html.replace(old_status, new_status, 1)

# CSS past 样式修改
style_start = html.find('<style>')
style_end = html.find('</style>')
style_content = html[style_start:style_end]
old_past = '''.tl-block.past {
      opacity: 0.55;
      background: #f9fafb;
    }'''
new_past = '''.tl-block.past {
      opacity: 0.5;
      background: #f3f4f6;
      border-left: 3px solid #d1d5db;
    }
    .tl-block.past .tl-task::after {
      content: " 未报";
      font-size: 11px;
      color: #9ca3af;
      margin-left: 4px;
    }'''
style_content = style_content.replace(old_past, new_past, 1)
html = html[:style_start] + style_content + html[style_end:]

# ============================================================
# 二、动态时间线生成器（基于真源实际进度）
# ============================================================
engine_marker = "// ═══════════════════════════════════════════════════════════\n// 第二层：引擎（通用逻辑层）"
engine_pos = html.find(engine_marker)
assert engine_pos > 0, "Engine marker not found"

dynamic_generator = '''
// ═══════════════════════════════════════════════════════════
// 动态时间线生成器（基于真源当前实际进度）
// ═══════════════════════════════════════════════════════════
function buildTimelineTasks(dayType, dateStr) {
  // 基础日课（所有日期通用）
  const baseTasks = [
    { id: "momo",      time: "7:45–8:45",   task: "墨墨单词 120",            desc: "复习优先、新学自动放量；熟知踢 10–20 个",        type: "memory",     diff: "低",   movable: false },
    { id: "anki-com",  time: "通勤",        task: "Anki 到期复习",          desc: "TTS 听题模式；再现卡优先",                      type: "memory",     diff: "低",   movable: false }
  ];

  // 从真源提取的当前实际进度（2026-10-04 确认）
  const progress = {
    shexin:    { current: "第1讲·第一章·心理学导论",    next: "第1讲·第一章·剩余部分", status: "进行中", pct: "≈8%" },
    puxin:     { current: "强化14-16章（未启动）",      next: "10/8启动",               status: "待启动", pct: "80%" },
    yanfa:     { current: "实验营回放完成",             next: "刷题课第1讲",            status: "实验营完", pct: "≈30%" },
    politics:  { current: "救命课专题七·垄断理论",      next: "专题八·资本主义",        status: "进行中", pct: "≈35%" },
    english:   { current: "单词日课",                   next: "阅读方法论",              status: "单词中", pct: "≈3%" },
    writing:   { current: "未启动",                     next: "方法课+仿写",             status: "未启动", pct: "0%" }
  };

  let tasks = [];

  if (dayType === "holiday") {
    tasks = [
      *baseTasks,
      { id: "politics",  time: "9:00–12:00",  task: "政治救命课：" + progress.politics.current,  desc: "极简救命课 · " + progress.politics.next + " · 当前" + progress.politics.pct,  type: "understand", diff: "中",   movable: true },
      { id: "300ti",     time: "14:00–16:00", task: "300 题马原",             desc: "三步法：听课→间隔做题→错题回炉 · 10/8收官",    type: "practice",   diff: "中高", movable: true },
      { id: "shexin",    time: "19:30–21:10", task: "社心强化课：" + progress.shexin.current,    desc: "按「第X讲·今晚听到YY:YY」口径 · " + progress.shexin.next + " · 当前" + progress.shexin.pct, type: "understand", diff: "中",   movable: true },
      { id: "anki-new",  time: "21:10–22:00", task: "Anki 新卡 + 薄弱回炉",   desc: "社心/政治马原新卡上限15；普心暂缓到10/8",        type: "practice",   diff: "低",   movable: true },
      { id: "anki-clear",time: "22:00–22:20", task: "Anki 清场",             desc: "到期清零；扫一眼明日任务",                     type: "memory",     diff: "低",   movable: false },
      { id: "report",    time: "22:20–22:30", task: "今日汇报",              desc: "学了什么、用时、卡点（直接发给助手）",         type: "rest",       diff: "低",   movable: false },
      { id: "blank",     time: "22:30–24:00", task: "留白",                  desc: "不排硬任务；缓冲池或休息",                     type: "rest",       diff: null, movable: false }
    ];
  } else if (dayType === "weekend") {
    tasks = [
      *baseTasks,
      { id: "morning",   time: "9:00–12:00",  task: "周六上午硬任务区",       desc: "实验仿写30min + 写作训练60min + 社心" + progress.shexin.current, type: "output",     diff: "高",   movable: true },
      { id: "afternoon", time: "14:00–16:00", task: "复盘 + 错题 + 研方法刷题", desc: "研方法：" + progress.yanfa.next + " · 当前" + progress.yanfa.pct, type: "practice",   diff: "中高", movable: true },
      { id: "evening",   time: "19:30–21:10", task: "社心强化课：" + progress.shexin.current,    desc: progress.shexin.next + " · 当前" + progress.shexin.pct, type: "understand", diff: "中",   movable: true },
      { id: "anki-new",  time: "21:10–22:00", task: "Anki 新卡 + 薄弱回炉",   desc: "社心/政治马原新卡上限15",                      type: "practice",   diff: "低",   movable: true },
      { id: "anki-clear",time: "22:00–22:20", task: "Anki 清场",             desc: "到期清零",                                     type: "memory",     diff: "低",   movable: false },
      { id: "report",    time: "22:20–22:30", task: "今日汇报",              desc: "直接发给助手",                                 type: "rest",       diff: "低",   movable: false },
      { id: "blank",     time: "22:30–24:00", task: "留白",                  desc: "周日留白：只保日课",                            type: "rest",       diff: null, movable: false }
    ];
  } else {
    tasks = [
      *baseTasks,
      { id: "main",      time: "19:30–21:10", task: "晚间主线：社心 " + progress.shexin.current, desc: progress.shexin.next + " · 当前" + progress.shexin.pct, type: "understand", diff: "中",   movable: true },
      { id: "sub",       time: "21:10–22:00", task: "次线：" + (progress.politics.status === "进行中" ? "政治救命课" : "章节待定"), desc: progress.politics.status === "进行中" ? progress.politics.current + " · " + progress.politics.next : "真源未登记当前次线", type: "practice",   diff: "中",   movable: true },
      { id: "anki-clear",time: "22:00–22:30", task: "Anki 清场 + 汇报",       desc: "到期清零；汇报直接发给助手",                   type: "rest",       diff: "低",   movable: false },
      { id: "blank",     time: "22:30–24:00", task: "留白",                  desc: "不排硬任务",                                   type: "rest",       diff: null, movable: false }
    ];
  }
  return tasks;
}

'''
html = html[:engine_pos] + dynamic_generator + html[engine_pos:]

# 修改 renderTimeline 使用动态生成器
old_template_select = '''  // 选择模板
  const tpl = getTemplate(dayInfo.type);
  let plan = JSON.parse(JSON.stringify(tpl.tasks));
  currentPlan = plan;'''
new_template_select = '''  // 动态生成当日任务（基于真源实际进度）
  let plan = buildTimelineTasks(dayInfo.type, dateStr);
  currentPlan = plan;'''
html = html.replace(old_template_select, new_template_select, 1)

# ============================================================
# 三、学习汇报功能定界：去掉按钮，改为引导文案
# ============================================================
old_btn = 'reportBtn: "提交汇报并更新"'
new_btn = 'reportBtn: ""'
html = html.replace(old_btn, new_btn, 1)

old_hint2 = 'reportHint: "助手收到后：①记台账 → ②算缺口 → ③按难度重排 → ④更新看板"'
new_hint2 = 'reportHint: "「学习汇报」为日终汇总式：每天汇报一次即可，无需逐个提交。把今日完成情况直接发给助手（对话），由助手完成①记台账 → ②算缺口 → ③按难度重排 → ④更新看板。本页不提供提交功能。"'
html = html.replace(old_hint2, new_hint2, 1)

old_report_area = '''  html += '<h2>' + CONFIG.ui.howToReportTitle + ' <span class="tag">' + CONFIG.ui.howToReportTag + '</span></h2>';
  html += '<div style="font-size:13px;color:#374151;line-height:1.7;">';
  html += '大白话即可，不用填表。例子：<br>';
  html += '<span style="color:#6b7280;">"' + CONFIG.ui.reportExample + '"</span><br><br>';
  html += '助手收到后固定走四步：①记台账 → ②算缺口 → ③按难度重排 → ④更新看板。';
  html += '</div>';'''

new_report_area = '''  html += '<h2>' + CONFIG.ui.howToReportTitle + ' <span class="tag">' + CONFIG.ui.howToReportTag + '</span></h2>';
  html += '<div style="font-size:13px;color:#374151;line-height:1.7;">';
  html += '<strong style="color:#d93025;">本页不提供提交功能。</strong> 把今日完成情况直接发给助手（对话），由助手完成后续处理。<br><br>';
  html += '汇报格式：大白话即可，不用填表。例子：<br>';
  html += '<span style="color:#6b7280;">"' + CONFIG.ui.reportExample + '"</span><br><br>';
  html += '助手收到后固定走四步：①记台账 → ②算缺口 → ③按难度重排 → ④更新看板。';
  html += '</div>';'''
html = html.replace(old_report_area, new_report_area, 1)

old_report_html = '''  <!-- 学习汇报区 -->
  <div class="card">
    <h2 id="report-title">学习汇报 <span class="tag">直接输入</span></h2>
    <textarea class="report-area" id="report-input" placeholder="例：单词120刷完，社心第1讲听到45min，政治第3讲听完，其他没动"></textarea>
    <button class="report-btn" onclick="processReport()">提交汇报并更新</button>
    <div class="report-hint" id="report-hint"></div>
    <div id="report-result" style="margin-top:10px;font-size:12px;color:#374151;display:none;"></div>
  </div>'''

new_report_html = '''  <!-- 学习汇报区（引导文案，不提供提交功能） -->
  <div class="card">
    <h2 id="report-title">学习汇报 <span class="tag">日终汇总</span></h2>
    <div style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:12px;">
      <strong style="color:#d93025;">本页不提供提交功能。</strong> 把今日完成情况<strong>直接发给助手（对话）</strong>，由助手完成记台账、算缺口、重排看板。<br>
      每天汇报一次即可，不用逐个提交。例子：<span style="color:#6b7280;">"今天单词120刷完，社心第1讲听到45min，政治第3讲听完，其他没动"</span>
    </div>
    <div class="report-hint" id="report-hint"></div>
    <div id="report-result" style="margin-top:10px;font-size:12px;color:#374151;display:none;"></div>
  </div>'''
html = html.replace(old_report_html, new_report_html, 1)

old_process = '''function processReport() {
  const input = document.getElementById("report-input");
  const result = document.getElementById("report-result");
  const text = input.value.trim();

  if (!text) {
    result.textContent = "请输入汇报内容";
    result.style.display = "block";
    result.style.color = "#d93025";
    return;
  }

  let found = [];
  for (let k in CONFIG.reportKeywords) {
    if (text.includes(k)) found.push(k);
  }

  let msg = "已识别关键词：" + (found.length ? found.join("、") : "无明确匹配") + "\\n";
  msg += "请将此汇报复制发送给助手，由助手完成：①记台账 → ②算缺口 → ③按难度重排 → ④更新看板。";

  result.textContent = msg;
  result.style.display = "block";
  result.style.color = "#374151";
  result.style.whiteSpace = "pre-line";
}'''

new_process = '''function processReport() {
  // 已移除：本页不提供提交功能
  // 汇报请直接发给助手（对话）
}'''
html = html.replace(old_process, new_process, 1)

# ============================================================
# 四、备考路线图按实际进度动态显示
# ============================================================
old_roadmap = '''function renderRoadmap() {
  const container = document.getElementById("roadmap-card");
  if (!container) return;
  let html = '<h2>' + CONFIG.ui.roadmapTitle + ' <span class="tag">' + CONFIG.ui.roadmapTag + '</span></h2>';
  html += '<div class="stage-map">';
  CONFIG.stages.forEach(stage => {
    html += '<div class="stage-box ' + stage.status + '">';
    html += '<div>' + stage.key + ' · ' + stage.name + '</div>';
    html += '<div class="s-date">' + stage.dateRange + '</div>';
    html += '<div class="s-mark">' + stage.mark + '</div>';
    html += '</div>';
  });
  html += '</div>';'''

new_roadmap = '''function renderRoadmap() {
  const container = document.getElementById("roadmap-card");
  if (!container) return;

  // 计算各科实际完成度（基于 CONFIG.subjects 三层进度）
  let totalWeight = 0, totalDone = 0;
  let delayedSubjects = [];
  CONFIG.subjects.forEach(subj => {
    const w = { "社心": 80, "普心 / 心理学导论": 90, "研究方法": 80, "外语": 100, "政治": 100, "综合写作": 50 }[subj.name] || 50;
    let subjDone = 0, subjTotal = 0;
    CONFIG.progressLayers.forEach(layer => {
      const ld = subj.layers[layer.key];
      if (!ld.missing) {
        subjDone += ld.pct;
        subjTotal += 100;
      }
    });
    const subjPct = subjTotal > 0 ? Math.round(subjDone / subjTotal * 100) : 0;
    totalDone += subjPct * w;
    totalWeight += w;
    if (subj.name === "社心" && subj.layers.watch.pct < 30) delayedSubjects.push("社心");
    if (subj.name === "普心 / 心理学导论" && subj.layers.watch.pct < 85) delayedSubjects.push("普心收尾");
    if (subj.name === "研究方法" && subj.layers.watch.pct < 50) delayedSubjects.push("研方法刷题");
  });
  const overallPct = totalWeight > 0 ? Math.round(totalDone / totalWeight) : 0;

  let html = '<h2>' + CONFIG.ui.roadmapTitle + ' <span class="tag">' + CONFIG.ui.roadmapTag + '</span></h2>';
  html += '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">';
  html += '整体加权完成度：' + overallPct + '%（基于各科三层进度 · 无记录层不计入）';
  if (delayedSubjects.length > 0) {
    html += ' · <span style="color:#d93025;">延期预警：' + delayedSubjects.join("、") + '</span>';
  }
  html += '</div>';
  html += '<div class="stage-map">';
  CONFIG.stages.forEach(stage => {
    let actualMark = stage.mark;
    let extraCls = stage.status;
    if (stage.status === "now") {
      actualMark = "◀ 现在 · 实际 " + overallPct + "%";
      if (delayedSubjects.length > 0) {
        actualMark += " · <span style=\\'color:#d93025\\'>延期" + delayedSubjects.length + "项</span>";
        extraCls += " delayed";
      }
    }
    html += '<div class="stage-box ' + extraCls + '">';
    html += '<div>' + stage.key + ' · ' + stage.name + '</div>';
    html += '<div class="s-date">' + stage.dateRange + '</div>';
    html += '<div class="s-mark">' + actualMark + '</div>';
    html += '</div>';
  });
  html += '</div>';'''
html = html.replace(old_roadmap, new_roadmap, 1)

# 添加 delayed 样式
style_start2 = html.find('<style>')
style_end2 = html.find('</style>')
style2 = html[style_start2:style_end2]
if '.stage-box.delayed {' not in style2:
    style2 = style2.replace('.stage-box.past { opacity:0.45; background:#f3f4f6; }',
                           '.stage-box.past { opacity:0.45; background:#f3f4f6; }\n    .stage-box.delayed { border: 2px solid #d93025; background:#fef2f2; }')
    html = html[:style_start2] + style2 + html[style_end2:]

# 验证
assert 'buildTimelineTasks' in html
assert '本页不提供提交功能' in html
assert '整体加权完成度' in html
assert '当天未汇报 = 默认未完成' in html
assert html.count('<script>') == html.count('</script>')

open("index.html", "w", encoding="utf-8").write(html)
print("MODIFIED OK: lines=" + str(len(html.splitlines())))
