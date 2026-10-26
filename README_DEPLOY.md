# UptimeFlare Pro 2.0 —— 全新改版与深度优化落地指南

本安装包基于您当前部署在 Cloudflare 上的 UptimeFlare 生产配置（Account ID: `1b0d558ee0b404546e096c0217fa51ae`，D1 数据库: `141cdac0-c9ab-4a54-b267-bfedf3c84ea9`）进行了**核心监控引擎深度优化**与**状态大盘 UI/UX 2.0 全新改版**，并与现有 D1 数据库中的 `state` 数据结构保持 **100% 无损向后兼容**，部署后直接继承全部历史可用率与延迟记录。

---

## 一、 核心升级与深度优化清单

### 1. 边缘监控引擎 (`worker/src/*`) 深度优化
- **瞬时网络抖动自动重试（Anti-Jitter Retry）**：在 `worker/src/monitor.ts` 中新增可配置的单次失败重试机制（默认 `retries: 1`，间隔 `600ms`），彻底消除 Cloudflare 跨 Colo 边缘网络偶发单次抖动导致的误报飘红，同时在目标站点正常时保持零额外开销。
- **边缘节点定位超时保护**：为 `getWorkerLocation()` (`https://cloudflare.com/cdn-cgi/trace`) 增加 `3000ms` 超时保护与 `CF-EDGE` 兜底降级，解决上游 `cdn-cgi/trace` 偶发卡死导致整轮定时巡检崩溃的问题。
- **严格的边缘缓存穿透**：巡检请求默认注入 `Cache-Control: no-cache, no-store, must-revalidate` 与 Cloudflare `cf: { cacheTtl: -1, cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } }`，杜绝因边缘缓存导致的假阳性存活。
- **跨平台高性能 Hex 编解码与越界自愈**：重构 `worker/src/store.ts`，移除对实验性 `Uint8Array.fromHex` 的强依赖（消除浏览器与低版本运行时的控制台告警），并对新增监控项未初始化时的 `getIncident` / `getLastLatency` 做空安全兜底，彻底修复新增监控项在首轮 Cron 运行前导致页面与 `/api/data` 报 500 崩溃的缺陷。
- **增强型桥接与健康诊断接口**：
  - `GET /__trigger?key=uf-bridge-2026`：保留原有异步触发模式；
  - `GET /__trigger?key=uf-bridge-2026&sync=1`：新增同步等待模式，直接返回本次巡检的节点位置、耗时（`durationMs`）、在线/离线计数与更新时间戳 JSON；
  - `GET /__health`：新增 Worker 与 D1 绑定状态诊断端点。

### 2. 状态大盘前端架构与视觉体验 (UI/UX 2.0)
- **业务架构分组展示 (`uptime.config.ts`)**：保留全部 10 个生产站点原有 `id`（`cf-workers-nav`、`cloudmark`、`sink`、`flaremo`、`flarestarter`、`imgbed`、`davflare-oss`、`davflare-sites`、`excali-draw`、`excali-relay`），划分为 **效率工具与导航服务**、**云存储、图床与文件分发**、**实时协作与白板服务** 三大业务分组，并补充功能说明气泡。
- **Hero 总览横幅 + 4 大核心 KPI 指标卡 (`OverallStatus.tsx`)**：
  1. **90天综合可用率**：全站加权 SLA 百分比；
  2. **在线服务节点**：实时在线/总监控数对比；
  3. **全网平均延迟**：实时计算全站平均延迟、P95 峰值延迟及当前探测边缘节点（Colo）；
  4. **90天历史故障**：自动统计近 90 天真实故障次数与当前活跃异常。
- **无感静默热更新 (`pages/index.tsx` + `/api/state`)**：废弃原版每隔 5 分钟强制整页 `window.location.reload()` 造成的白屏闪烁，改为每 60 秒后台静默拉取 `/api/state` 热刷新数据，并在导航栏与横幅提供「立即刷新」按钮。
- **交互式筛选与紧凑/图表双视图 (`MonitorList.tsx` + `MonitorDetail.tsx`)**：
  - 支持按关键词实时搜索站点名称/域名；
  - 支持一键筛选「全部服务 / 仅看正常 / 仅看异常」；
  - 支持切换「图表视图」与「紧凑视图」（紧凑视图下默认折叠曲线图，单屏即可纵览全部 10 个站点，同时支持单站点独立展开趋势图）；
  - 每个监控项顶部直观展示 **最新延迟 + 探测节点 (Colo)**、**均值 / P95 延迟** 与 **90 天可用率**。
- **全宽自适应 90 天热力条与渐变面积图 (`DetailBar.tsx` + `DetailChart.tsx`)**：
  - 90 天可用率条改为纯 CSS Flexbox 弹性布局，在桌面端与移动端均可完整自适应展示，不再因屏幕宽度截断历史天数；
  - 延迟曲线升级为平滑渐变面积图（Area Chart），自动适配深色/浅色模式。
- **真实历史故障归档中心 (`pages/incidents.tsx`)**：
  - 修复上游原版 `/incidents` 页面只读取静态 `maintenances` 配置而不展示 D1 真实故障记录的缺陷；
  - 现可直接解析并按月展示 D1 中记录的所有真实服务中断事件、持续时长、恢复状态与边缘节点报错日志。

---

## 二、 快速落地部署方式

### 方式 A：本地 / 服务器 Wrangler 一键部署（推荐）
解压安装包后，在项目根目录执行：

```bash
chmod +x deploy.sh
./deploy.sh
```

或者分步执行：

```bash
# 1. 安装依赖
npm install && (cd worker && npm install)

# 2. 部署监控 Worker (自动绑定 uptimeflare_d1 与 RemoteChecker DO)
npm run deploy:worker

# 3. 构建并部署 Cloudflare Pages 前端
npm run deploy:pages
```

### 方式 B：GitHub Actions 自动部署
直接将解压后的代码覆盖推送至您的 GitHub 仓库 `main` 分支，仓库内置的 `.github/workflows/deploy.yml` 会自动完成 Worker、D1 与 Pages 的全流程构建与发布。
