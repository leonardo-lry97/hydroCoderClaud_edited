# 构建说明

## 命名规则

| 类型 | 规则 | 示例 |
|------|------|------|
| electron-builder 输出 | `CC-Desktop-{version}-{platform}-{arch}.{ext}` | `CC-Desktop-1.6.45-darwin-arm64.dmg` |
| macOS 一键安装包 | `cc-desktop-{version}-macos-{arch}-installer.tar.gz` | `cc-desktop-1.6.45-macos-arm64-installer.tar.gz` |
| Windows 一键安装包 | `cc-desktop-{version}-windows.zip` | `cc-desktop-1.6.45-windows.zip` |

**注意**：一键安装包名称不带 `v` 前缀。

---

## 本地打包

### macOS

**前提**

- 必须在 `macOS` 主机或 `GitHub Actions macOS runner` 上构建
- 当前项目包含 `node-pty` 等原生模块，`Linux` 环境不能稳定交叉编译 macOS 安装包

**命令**
```bash
npm run build:mac:local
```

**说明**：编译 DMG 并打包一键安装包。建议按架构分别构建。

**产物**

| 文件 | 用途 |
|------|------|
| `dist/CC-Desktop-{version}-darwin-arm64.dmg` | Apple Silicon 手动安装 |
| `dist/CC-Desktop-{version}-darwin-x64.dmg` | Intel 手动安装 |
| `dist/cc-desktop-{version}-macos-arm64-installer.tar.gz` | Apple Silicon 一键安装包 |
| `dist/cc-desktop-{version}-macos-x64-installer.tar.gz` | Intel 一键安装包 |

**不生成**：zip、blockmap、latest-mac.yml（自动更新相关，本地不需要）

---

### Windows

**命令**
```powershell
npm run build:win:local
```

**说明**：编译 EXE 并打包一键安装包，一条命令完成。

**产物**

| 文件 | 用途 |
|------|------|
| `dist/CC-Desktop-{version}-win32-x64.exe` | Windows 安装程序 |
| `dist/cc-desktop-{version}-windows.zip` | 一键安装包（含 exe + install.ps1 + README） |

**不生成**：blockmap、latest.yml（自动更新相关，本地不需要）

---

## CI（GitHub Actions）

触发条件：推送 `v*` tag，或 workflow_dispatch 手动触发并填写版本号。

### macOS（build-macos-arm64 / build-macos-x64）

| 文件 | 用途 |
|------|------|
| `CC-Desktop-{version}-darwin-arm64.dmg` | Apple Silicon 手动安装 |
| `CC-Desktop-{version}-darwin-x64.dmg` | Intel 手动安装 |
| `CC-Desktop-{version}-darwin-arm64.dmg.blockmap` | 差量更新索引（无签名，实际无效） |
| `CC-Desktop-{version}-darwin-x64.dmg.blockmap` | 同上 |
| `CC-Desktop-{version}-darwin-arm64.zip` | Apple Silicon 自动更新包 |
| `CC-Desktop-{version}-darwin-x64.zip` | Intel 自动更新包 |
| `CC-Desktop-{version}-darwin-arm64.zip.blockmap` | 差量更新索引（无签名，实际无效） |
| `CC-Desktop-{version}-darwin-x64.zip.blockmap` | 同上 |
| `latest-mac.yml` | macOS 自动更新检查元数据 |
| `cc-desktop-{version}-macos-arm64-installer.tar.gz` | Apple Silicon 一键安装包 |
| `cc-desktop-{version}-macos-x64-installer.tar.gz` | Intel 一键安装包 |

### macOS（手动触发工作流）

仓库还提供独立工作流：

- `.github/workflows/mac-package.yml`
- Actions 名称：`Manual macOS Package`

用途：

- 只构建 macOS，不等待 Windows / Release
- 适合单独产出安装包交付用户

### Windows（build-windows job）

| 文件 | 用途 |
|------|------|
| `CC-Desktop-{version}-win32-x64.exe` | Windows 安装程序 / 自动更新下载包 |
| `CC-Desktop-{version}-win32-x64.exe.blockmap` | 差量更新索引（Windows 有效） |
| `latest.yml` | Windows 自动更新检查元数据 |
| `cc-desktop-{version}-windows.zip` | 一键安装包（含 exe + install.ps1 + README） |

---

## 自动更新说明

| 平台 | 差量更新 | 原因 |
|------|---------|------|
| macOS | ✗ | 无代码签名，无法验证差量结果 |
| Windows | ✓ | 不依赖签名，正常工作 |

macOS 自动更新下载完整 ZIP，通过自定义安装脚本完成安装（`macOSManualInstall`）。
Windows 自动更新通过 `autoUpdater.quitAndInstall()` 静默运行 NSIS 安装程序。

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `.github/workflows/build.yml` | 完整 CI 构建与发布流程 |
| `.github/workflows/mac-package.yml` | 独立 macOS 安装包构建流程 |
| `scripts/local-package-mac.sh` | macOS 本地打包脚本（生成 tar.gz） |
| `scripts/local-package-win.ps1` | Windows 本地打包脚本（生成 windows.zip） |
| `scripts/install.sh` | 用户侧 macOS 一键安装脚本（打包进 tar.gz） |
| `scripts/install.ps1` | 用户侧 Windows 一键安装脚本（打包进 windows.zip） |
| `src/main/update-manager.js` | 自动更新管理器 |
