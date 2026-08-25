# 发布说明

## Windows 发布策略

Windows 只发布 NSIS `.exe` 安装包，不生成或发布 WiX/MSI。

- Tauri 默认打包目标：`src-tauri/tauri.conf.json` 的 `bundle.targets = ["nsis"]`。
- 本地构建：`npm run desktop:build`。
- 输出目录：`src-tauri/target/release/bundle/nsis/`。
- 自动更新：保留 `createUpdaterArtifacts: "v1Compatible"` 和签名文件；发布环境必须配置 `TAURI_SIGNING_PRIVATE_KEY`。
- Windows CI 发布：`.github/workflows/release.yml` 显式使用 `npx tauri build --bundles nsis`。

## macOS

macOS 由发布工作流显式指定 `app,dmg` 构建目标。它不改变 Windows 只发布 NSIS 的决策。

## 发布前检查

```bash
npm run typecheck
npm test
npm run lint:baseline
npm run build
```

发布前还应确认应用版本在 `package.json` 和 `src-tauri/tauri.conf.json` 中一致，并检查更新器签名与下载地址。
