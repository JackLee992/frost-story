# 冰霜物语 · Android 壳工程（GeckoView 独立内核）

本目录是「冰霜物语」的 Android 原生壳：**不使用系统 WebView**，而是内置 Mozilla
**GeckoView（自带 Gecko 独立浏览器内核）**，游戏本体（PixiJS v8 + WebGL）放在
`app/src/main/assets/web`，由 App 内的 `127.0.0.1` 本地 HTTP 服务托管。

```
游戏逻辑/渲染  = assets/web（与浏览器版完全同一份代码，iOS 后续换 WKWebView 壳即可复用）
原生壳        = Kotlin：GeckoRuntime 初始化 + GeckoView 承载 + LocalAssetServer 回环托管
```

## 一、用 Android Studio 出 APK（推荐）

1. 安装最新版 **Android Studio**，首次启动装好 SDK：
   - SDK Platform：Android 17.1（compileSdk 37.1；targetSdk 36）
   - JDK 用 Android Studio 自带的 **JBR 17**（Settings → Build → Gradle → Gradle JDK）
2. `File → Open` 选择本 `android/` 目录，等待 Gradle Sync（当前为 Gradle 9.6、
   AGP 9.4.0、Kotlin 2.4.10、GeckoView 155；首次需联网下载较大的 GeckoView AAR）。
3. 连接 Android 8.0+ ARM64 手机（开启 USB 调试）或启动 ARM64 模拟器。
4. 点 ▶ Run 'app'；或命令行：
   ```bash
   cd android
   ./gradlew assembleDebug          # 产物：app/build/outputs/apk/debug/app-debug.apk
   ./gradlew installDebug           # 直接装到已连接设备
   ```
   Release 签名包：先在仓库根执行 `tools/create_release_keystore.sh`，再运行
   `./gradlew assembleRelease`。签名配置保存在 `~/.frost-story/`，必须离线备份且不得提交。

> 本机若没有 JDK/Gradle 也没关系，Android Studio 自带，无需额外安装。

## 二、修改游戏后如何同步

游戏源码在仓库根的 `web/`，本工程只在打包时把它拷进 assets。**改完 web 后执行：**

```bash
bash ../tools/sync_android.sh
```

再 Run/Build 即可。脚本会剔除运行时用不到的切图源图（sheet_*/gen_*）以减小包体。

## 三、关键实现说明

| 文件 | 作用 |
|---|---|
| `app/src/main/java/.../FrostApp.kt` | 全局唯一 `GeckoRuntime`：开 JS、允许触摸后媒体自动播放（BGM） |
| `app/src/main/java/.../MainActivity.kt` | 竖屏全屏沉浸式；创建 GeckoSession（开 DOM Storage 存档）并加载本地地址；返回键“再按一次退出” |
| `app/src/main/java/.../LocalAssetServer.kt` | 仅绑定 `127.0.0.1` 的静态服务器，把 `assets/web` 以 HTTP 提供，规避 `file://` 的 fetch/音频限制，也为后续热更预留通道 |

- **为什么用回环 HTTP 而不是 file:///android_asset**：`file://` 下 `fetch` 本地 JSON、
  WebGL 纹理与 WebAudio 在部分内核上受限；本地 HTTP 与线上环境行为完全一致。
- **存档**：网页侧用 `localStorage`（键 `froststory.save.v1`），GeckoView 开启
  `domStorageEnabled` 后持久化在 App 私有目录，卸载即清除。
- **内核升级**：只需改 `app/build.gradle.kts` 里 geckoview 版本号（官方源
  https://maven.mozilla.org/maven2 ，选最新 stable）。
- **ABI**：v0.1 发行包只包含 `arm64-v8a`，用于把内置 Gecko 的 APK 体积控制在约 220 MB。
- **全屏安全区**：原生层读取 `DisplayCutout` 与强制手势边距，转换成 CSS 像素传给游戏；HUD、订单、棋盘、弹窗和底部导航都在安全矩形内。
- **内容更新**：启动时后台检查 GitHub 清单；通过 HTTPS、大小、SHA-256、ZIP 路径和配额校验后，下次启动切换到新内容。

## 四、后续 iOS

游戏代码零改动，另建 Xcode 工程用 **WKWebView + 本地 localhost GCDWebServer**
（WKWebView 本身就是独立 WebKit 内核）等价替换本壳即可。
