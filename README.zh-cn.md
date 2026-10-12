[English](./README.md) | [简体中文](./README.zh-cn.md)

# Token Balance

![screenshot](./screenshot.png)

一个轻量的 **Tauri 2** 桌面小组件，常驻系统托盘，一览 LLM API 余额 / 配额——每个连接一个置顶迷你窗口。

## 功能

- **多 Provider、每连接独立窗口**——无边框半透明迷你窗口（DeepSeek 钱包余额、GLM Coding Plan 配额进度条）。没有主窗口，一切入口都在托盘。
- **系统托盘菜单**
  - *全部刷新*——强制刷新所有连接
  - *添加连接*——保存前先实时验证 API Key
  - *连接列表*——勾选 = 窗口可见，点击切换显示/隐藏
  - *退出*
- **自动刷新**：每连接每 30 秒轮询，出错指数退避（上限 15 分钟）；上次刷新时间在刷新按钮的 tooltip 里
- **Provider 口径**
  - **DeepSeek**——纯预付费余额：总额 / 赠送 / 充值（官方 `/user/balance` 接口）
  - **GLM Coding Plan**——剩余积分反向进度条：5 小时滚动窗口 + 每周窗口，含重置倒计时和套餐档位徽标（社区发现的 `GET /api/monitor/usage/quota/limit` 接口——非官方，智谱改版可能失效）
- **窗口体验**
  - 位置记忆，启动时校验；位置非法（拔显示器、改分辨率）自动回退到主屏右上角竖直排列
  - 每窗口不透明度滑杆（30–100%，持久化）
  - 刷新 / 删除收进 `⋯` 下拉菜单；删除需二次确认
  - 任意位置可拖拽（按钮/输入框除外）；无滚动条

## 快速开始

前置要求：Node.js LTS、Rust（Windows 需 MSVC 工具链）、WebView2（Win10/11 预装）。

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 生产构建（exe + MSI/NSIS 安装包）
```

从托盘菜单 *添加连接* 添加第一个连接：选 provider、粘贴 API Key、保存。Key 以明文 JSON 存在本地——个人工具可接受。

配置位于 `%APPDATA%\com.tokenbalance.app\`：
- `config.json`——连接信息（provider、名称、API Key、Base URL）
- `positions.json`——记忆的窗口位置

## 新增 Provider

1. 新建 `src/providers/<name>.ts`，实现 `TokenProvider` 接口（`fetchBalance` 返回 `wallet` 或 `quota` 类型余额）。
2. 在 `src/providers/registry.ts` 注册。
3. 如有新的 API 域名，加入 `src-tauri/capabilities/default.json` 的 `http:default` URL 白名单。

开发细节见 [AGENTS.md](./AGENTS.md)。
