#!/usr/bin/env bash
# ==============================================================================
# UptimeFlare Pro 2.0 —— Cloudflare 一键落地部署脚本
# 适用架构：Cloudflare Pages (前端状态面板) + Workers (边缘定时巡检 + DO) + D1 (SQLite 存储)
# 已预置绑定：
#   - Account ID: 1b0d558ee0b404546e096c0217fa51ae
#   - D1 Database: uptimeflare_d1 (141cdac0-c9ab-4a54-b267-bfedf3c84ea9)
# ==============================================================================
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  🚀 UptimeFlare Pro 2.0 · Cloudflare 一键落地部署向导          ${NC}"
echo -e "${CYAN}================================================================${NC}"

# 1. 检查 Node.js 与依赖
echo -e "\n${YELLOW}[1/5] 安装前端与 Worker 依赖...${NC}"
npm install
(cd worker && npm install)

# 2. 初始化/幂等校验 D1 数据库表结构
echo -e "\n${YELLOW}[2/5] 校验 Cloudflare D1 数据库表结构 (init.sql)...${NC}"
npx wrangler d1 execute uptimeflare_d1 --remote --file=init.sql || {
  echo -e "${YELLOW}提示：如遇认证提示，请先执行 'npx wrangler login' 或设置 CLOUDFLARE_API_TOKEN 环境变量。${NC}"
  exit 1
}

# 3. 部署监控核心 Worker (含 Cron Triggers 与 Durable Object)
echo -e "\n${YELLOW}[3/5] 部署边缘巡检 Worker (worker/wrangler.toml)...${NC}"
(cd worker && npx wrangler deploy)

# 4. 构建并部署 Cloudflare Pages 状态大盘
echo -e "\n${YELLOW}[4/5] 构建 Next.js Edge 状态页并发布至 Cloudflare Pages...${NC}"
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static --project-name uptimeflare --branch main

# 5. 完成提示
echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}  ✅ UptimeFlare Pro 2.0 部署完成！${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e "  • 状态页将自动继承 D1 (uptimeflare_d1) 中的全部 10 个站点历史数据"
echo -e "  • 手动立即触发一次同步巡检接口：GET /__trigger?key=uf-bridge-2026&sync=1"
echo -e "  • 巡检 Worker 健康度诊断接口：  GET /__health"
echo -e "  • 状态页静默热更新 API 接口：   GET /api/state"
