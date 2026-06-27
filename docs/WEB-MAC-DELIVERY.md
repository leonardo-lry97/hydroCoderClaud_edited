# Web 与 macOS 交付说明

## 1. 可执行任务的 Web 端

当前仓库已经包含一个可真实执行任务的 Web 工作台：

- 首页入口：`/`
- 第三阶段工作台：`/workbench`
- 在线对话页：`/web-chat`

### 本地启动

1. 安装依赖

```bash
npm install
```

2. 设置环境变量

```bash
cp .env.example .env.example.local
export DEEPSEEK_API_KEY="你的 DeepSeek Key"
export DEEPSEEK_MODEL="deepseek-chat"
export WEB_PORT="8787"
```

3. 启动 Web 服务

```bash
npm run web
```

4. 打开页面

- `http://localhost:8787/workbench`
- `http://localhost:8787/web-chat`

### 当前 Web 端能力

- 真实调用 DeepSeek，对话密钥只在后端
- 支持普通发送与流式输出
- 支持参考网页 URL 抽取
- 支持文本上下文补充
- 支持 SQLite 会话与任务记录持久化
- 支持任务模板、最近任务、关联会话回看

### 生产部署建议

- 前端静态资源：Vite 构建输出到 `src/renderer/pages-dist`
- 后端服务：`node src/server/web-chat-server.js`
- 运行方式：建议 `pm2` / `systemd` 常驻
- 反向代理：`Nginx` 或 `Caddy`
- 数据目录：默认 `.web-chat-data/`

示例启动命令：

```bash
DEEPSEEK_API_KEY="你的 DeepSeek Key" \
WEB_HOST="0.0.0.0" \
WEB_PORT="8787" \
npm run web
```

## 2. macOS 安装包

### 当前结论

- 不能在 Linux 环境直接产出可安装的 mac 应用
- 原因是项目依赖 `node-pty` 等原生模块，Linux 无法为 mac 目标做稳定交叉编译
- 仓库已补齐 `dmg-license` 可选依赖，并新增独立 GitHub Actions 工作流用于在 macOS runner 上打包

### 一键构建方式

GitHub Actions 工作流：

- 文件：`.github/workflows/mac-package.yml`
- 名称：`Manual macOS Package`

使用方法：

1. 把当前代码推到 GitHub
2. 打开仓库的 `Actions`
3. 选择 `Manual macOS Package`
4. 点击 `Run workflow`
5. 选择需要的 `ref`
6. 勾选要构建的架构：
   - `build_arm64=true` 适用于 Apple Silicon
   - `build_x64=true` 适用于 Intel

### 构建产物

构建成功后会在 Actions Artifacts 中得到：

- `CC-Desktop-{version}-darwin-arm64.dmg`
- `CC-Desktop-{version}-darwin-x64.dmg`
- `cc-desktop-{version}-macos-arm64-installer.tar.gz`
- `cc-desktop-{version}-macos-x64-installer.tar.gz`

其中推荐直接交付给用户的是：

- `cc-desktop-{version}-macos-arm64-installer.tar.gz`
- `cc-desktop-{version}-macos-x64-installer.tar.gz`

压缩包内已经包含：

- 对应架构的 `.dmg`
- `install.sh`
- `README.md`
- `installer-arch.txt`

用户解压后运行：

```bash
bash install.sh
```

### 本地 mac 打包

如果你自己有一台 Mac，也可以直接在本机执行：

```bash
npm install
npm run build:mac:local
```

如果要分别打不同架构：

```bash
npx electron-builder --mac dmg zip --arm64 --publish never
bash scripts/package-mac-installers.sh "$(node -p "require('./package.json').version")" dist arm64
```

```bash
npx electron-builder --mac dmg zip --x64 --publish never
bash scripts/package-mac-installers.sh "$(node -p "require('./package.json').version")" dist x64
```

## 3. 推荐交付物

建议最终对外给这两项：

- Web 工作台地址：`/workbench`
- macOS 安装包：
  - Apple Silicon：`cc-desktop-{version}-macos-arm64-installer.tar.gz`
  - Intel：`cc-desktop-{version}-macos-x64-installer.tar.gz`
