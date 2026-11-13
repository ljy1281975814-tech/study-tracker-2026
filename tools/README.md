# tools/ — 交付前自检门禁（随仓库走）

## 为什么放这里（D0046 的 P4）
`.git/hooks/` **不随仓库版本化** ⇒ 换机 / 重新 clone 后门禁会**静默消失**。
因此把 hook 本体放进 `tools/`，并提供安装脚本。

## 换机 / re-clone 后必做一次
```sh
sh tools/install-hooks.sh
```

## 它做什么
推送前若本次改动涉及 `quiz/index.html`，强制运行：
```sh
node "C:/Users/42989/WorkBuddy/347备考/_运行资产/_quiz_preflight.js"
```
**不通过则 exit 1，拒绝推送。**

## 自检 8 项
① 应用 JS 无运行时异常 ② MAXQ 有效 ③ todayQueue 有效 ④ 第1题可解析
⑤ 教材顺序断言 ⑥ 队列内可作答 ⑦ 全库空答案 ≤2 ⑧ **带进度 fixture**

> ⑧ 是 2026-11-13 补的（D0046 P1：原 7 项在零进度下永远全绿，抓不到「有进度才出现」的 bug）
