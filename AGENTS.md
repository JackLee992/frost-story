# Frost Story Agent 接手指南

本文件是下一位编码 Agent 的首要入口，作用域为整个仓库。开始开发前请完整阅读，并把当前工作树、远端状态和测试结果作为事实来源；旧对话、截图说明或历史测试数字只能用于定位，不能代替重新验证。

## 1. 当前任务与交付状态

产品是原创竖屏 Merge-2 剧情游戏《冰霜物语》，Android 优先，Web 游戏逻辑由 PixiJS 承载，Android 使用 GeckoView 独立内核。

当前已经交付：

- 三章九个剧情重建节点（`n11`–`n33`）完整贯通。
- 6×8 棋盘、六条八级合成链、生成器、体力、订单、商店、宝箱、霜泡、图鉴、等级与自动存档。
- 六步新手引导和设置内永久玩法规则。
- Android 沉浸式全屏及四方向挖孔/手势安全区。
- 可拖动、左右吸边、重启后保持位置的“爽玩”按钮。
- GitHub Release APK、内容热更新流水线以及公开下载站。
- 可复用核心已拆成独立仓库，并以 Git submodule 固定版本接入。

线上入口：

| 项目 | 地址 / 基线 |
|---|---|
| 游戏仓库 | https://github.com/JackLee992/frost-story |
| 游戏功能基线 | `b97a962`（本文件的提交会位于其后） |
| Android 正式版 | https://github.com/JackLee992/frost-story/releases/tag/v0.1.0 |
| 下载站 | https://frost-story-download.s419505080.chatgpt.site |
| 核心引擎仓库 | https://github.com/JackLee992/frost-merge-core |
| 核心引擎版本 | `v0.1.0` / `8827f3ec7221c300b2d50e335fe9eb10ffb8c576` |
| 内容包 | `content-v0.1.0`，清单见 `distribution/content-manifest.json` |

发布 tag `v0.1.0` 指向 `9c29fc5`；`main` 随后增加了干净 checkout 的 Android assets 同步修复和官方 Maven 源优先修复。不要移动旧 tag。下一次 APK 发版应从最新 `main` 创建新版本并递增 `versionCode`。

不要把“完成 v0.1”理解成已经完成商业化全量产品。仓库扩容、云存档、账号、广告/IAP、活动系统、Battle Pass、服务端运营与 iOS 壳仍不在当前实现内。

## 2. 第一次进入仓库

必须带 submodule 克隆：

    git clone --recurse-submodules https://github.com/JackLee992/frost-story.git
    cd frost-story
    git status --short --branch
    git submodule status

已有 checkout 若 `web/js/engine/src` 缺失：

    git submodule update --init --recursive

正常状态应满足：

- 主仓库工作树干净，分支跟踪 `origin/main`。
- `web/js/engine` 指向已推送的核心提交，不能是本地孤立提交。
- 不提交 `distribution/*.apk`、内容 ZIP、`artifacts/qa/*`、签名材料或本机 `android/local.properties`。
- 开始修改前先看用户已有未提交改动，不覆盖、不重置、不顺手格式化无关文件。

安装 Web 测试依赖：

    npm ci
    npx playwright install chromium

在独立终端启动游戏：

    python3 -m http.server 8099 --directory web

然后执行：

    npm test

测试依赖固定的 `http://127.0.0.1:8099/`。不要用随机端口后再把连接失败误判为游戏失败。

下载站测试使用另一个终端：

    python3 -m http.server 8100 --directory site/dist
    npx playwright test test/site.spec.js --workers=1

## 3. 仓库边界

| 仓库 | 应包含 | 不应包含 |
|---|---|---|
| `frost-story` | 题材、剧情、配置、棋盘规则、Pixi 场景、Android 壳、下载站和宿主测试 | 可脱离本游戏独立演进的基础契约 |
| `frost-merge-core` | ActionResult、重复交互保护、稳定滚动刷新、渲染元数据隔离及独立测试 | 冰霜物语剧情、价格、素材、Pixi/Android 专用实现 |

当前 submodule 路径是 `web/js/engine`。浏览器直接从相对路径导入，因此不需要 bundler。

通用修复进入核心仓库必须同时满足：

- 与题材、数值、剧情和素材无关。
- 至少能被两种游戏或两种宿主复用。
- API 可在没有 PixiJS/Android 的环境中单测。
- 不让核心包反向依赖宿主状态。

修改核心的正确顺序：

1. 在 `frost-merge-core` 先添加能失败的最小测试。
2. 修复并运行 `npm test`。
3. 提交、推送并发布 SemVer tag。
4. 在宿主更新 `web/js/engine` 指针到已推送 commit/tag。
5. 重跑宿主 Web、Android 和真机回归。
6. 在宿主提交 submodule 指针。

禁止只在 detached submodule 中改代码却不推送核心仓库；那会让其他 checkout 无法恢复该提交。

## 4. 系统结构

    Android MainActivity
      -> 读取 DisplayCutout / mandatory gesture insets
      -> 启动 127.0.0.1:17843 LocalAssetServer
      -> 优先选择已验证的动态内容，否则使用 APK assets
      -> GeckoView 加载 index.html?safeTop=...&contentVersion=...
          -> Config 加载 web/config/*.json
          -> GameState 维护唯一业务状态
          -> BoardScene 负责 Pixi 棋盘与动画
          -> UI 负责 HUD、订单、弹窗、教学和爽玩按钮
          -> Save 写入 localStorage: froststory.save.v1

关键代码：

| 路径 | 责任 |
|---|---|
| `web/js/core/GameState.js` | 游戏状态、命令、存档迁移、交易原子性、剧情推进 |
| `web/js/core/Config.js` | 加载并索引五份 JSON 配置 |
| `web/js/core/Save.js` | `froststory.save.v1` 的防抖持久化 |
| `web/js/scenes/BoardScene.js` | Pixi 节点、拖拽、动画、bounds 与渲染同步 |
| `web/js/ui/UI.js` | 商店、订单、新手教学、规则页、弹窗与爽玩 FAB |
| `web/config/*.json` | 物品、平衡、商店、NPC、前三章剧情 |
| `web/js/engine/src/*` | 独立核心 submodule 的运行时模块 |
| `android/.../MainActivity.kt` | GeckoView、沉浸式全屏、安全区、生命周期 |
| `android/.../LocalAssetServer.kt` | 有界 GET/HEAD 回环静态服务器与 CSP |
| `android/.../ContentUpdateManager.kt` | HTTPS 内容下载、验证、staging 和次启动切换 |
| `android/.../ContentPathPolicy.kt` | URL/ZIP 路径安全策略 |
| `site/dist/*` | 公共下载站静态源 |

## 5. 不得破坏的行为契约

### 5.1 核心玩法与原创边界

必须保留品类核心循环：

`点生成器 → 产出 → 两两合并 → 交付订单 → 获得资源 → 扩棋盘/升级 → 剧情重建`

只对齐通用玩法和可观察工程机制。不得复制竞品角色、美术、对白、关卡数据、音频或专有代码。对齐依据及明确未实现项见 `docs/01` 和 `docs/03`。

### 5.2 状态命令和商店

- 所有可能失败的交易必须先完成全部校验，再进行一次状态写入。
- 返回 `ActionResult`；失败必须零写入并给出明确错误码。
- UI 通过 `runActionOnce` 防重复激活。
- 失败只显示 toast，不销毁或重建当前弹窗。
- 成功只局部刷新商店 `.m-body`，保留弹窗 identity 与 `scrollTop`。
- 宝箱加速、融冰等确认框只在成功后关闭。

商店相关改动必须重跑“成功购买后列表仍在”和“余额不足后列表/滚动仍在”两个路径。

### 5.3 Pixi 渲染

- 禁止给 Pixi DisplayObject 写自定义下划线字段；`_sx`、`_sy` 等可能是引擎内部状态。
- 跨帧业务元数据必须放入核心包的 `createDisplayMetaStore()` / `WeakMap`。
- 动画起点保存在闭包，不写进渲染对象。
- tween 销毁回调必须放在正确的 `onDone` 参数。
- 每次 sync 后活动棋子节点数必须等于状态棋子数，正常棋子 bounds 应在 1–120 px。
- 更新霜泡覆盖层前删除并销毁旧子节点。

违反这些规则曾直接造成贯穿屏幕的竖条、残影和错误阶级纹理。

### 5.4 全屏安全区

- 背景允许铺到物理屏幕边缘，但 HUD、订单、棋盘、弹窗、教学卡片和底部导航必须位于 `--safe-*` 矩形内。
- Android 安全区来自 `DisplayCutout` 与 mandatory gesture insets，经查询参数传给 Web。
- Web 入口把参数限制到 0–120 CSS px，再与浏览器 `env(safe-area-inset-*)` 取最大值。
- 新增悬浮控件必须考虑四边安全区、底部 dock 和横竖尺寸变化。

### 5.5 爽玩按钮

- 支持真实 pointer 拖动、左右吸边、纵向限幅。
- 不得落到 dock 或安全区之外。
- `pointerup` 和 `pointercancel` 使用同一收尾逻辑。
- 保存 `settings.fabSide` 与归一化 `fabY`，重启后位置一致。

### 5.6 存档

- 固定键为 `froststory.save.v1`。
- `GameState.hydrate()` 必须把外部/损坏值限幅，删除非法棋子和跳章数据，并恢复关键初始生成器。
- `LocalAssetServer.PORT=17843` 用于稳定 origin；不能随意改成随机端口，否则 localStorage 会表现为“丢档”。
- 当前端口被占用时会退回随机端口，这是已知风险，不要把该回退当成永久解决方案。

### 5.7 动态内容

- 只有 `web/` 内的剧情、配置、图片、音频和 Web 游戏代码可热更新。
- Kotlin、权限、GeckoView、签名或原生功能变化必须发新 APK。
- 更新包只允许 HTTPS 白名单主机，并校验版本、声明大小、SHA-256、重定向、ZIP 路径、文件数、单文件和总解压大小。
- 下载到 staging，完整验证后切换版本标记，运行中会话不热替换，下次启动生效。
- 内容版本目前使用自定义比较器；只使用单调递增的简单数字版本（例如 `0.2.0`），不要使用复杂 SemVer prerelease。

## 6. 权限、信任边界与副作用

游戏没有账号、服务端数据库、广告 SDK、支付、邮件、定时任务或嵌入式 Agent。

Android 权限只有：

- `INTERNET`：获取 GitHub 内容清单和内容包。
- `ACCESS_NETWORK_STATE`：网络状态。
- `VIBRATE`：触觉反馈。

主要信任边界：

| 流程 | 输入 / 边界 | 成功副作用 | 拒绝行为 |
|---|---|---|---|
| 玩家交易 | DOM 事件 → GameState | 扣资源并一次更新棋盘/订单 | 资源不足时零写入、保留 UI |
| 存档恢复 | localStorage → hydrate | 恢复有界状态 | 非法值回退/丢弃 |
| 内容更新 | GitHub HTTPS → Android 私有目录 | 写入 staging、切换 active version | 主机、大小、哈希或路径不合规则丢弃 |
| 本地资源 | Gecko → 127.0.0.1 server | 只读返回静态文件 | 非 GET/HEAD、隐藏/穿越路径、超限请求拒绝 |
| 下载站 | 公共浏览器 → GitHub API/Raw | 只读取最新版和内容版本 | 请求失败使用内置版本与 latest 下载后备链接 |
| 发布 | 维护者 → GitHub/Sites | 创建 Release、更新 manifest 或生产站点 | 无授权凭证时停止，不把凭证写入仓库 |

`MainActivity` 是 launcher exported Activity，但不读取外部 Intent 数据。回环服务器不提供写接口、不含用户秘密；仍要保持请求大小、线程池和路径限制。

## 7. 配置与秘密

| 名称/位置 | 类型 | 用途 | 处理规则 |
|---|---|---|---|
| `android/local.properties` | 本机配置 | Android SDK 路径 | 已忽略，不提交 |
| `JAVA_HOME` | 本机环境 | Gradle JDK 17 | 可指向 Android Studio JBR |
| `FROST_STORY_SIGNING_PROPERTIES` | 可选环境变量 | 覆盖 Release 签名属性文件位置 | 不输出值，不进 CI 日志 |
| `~/.frost-story/release-signing.properties` | 秘密 | 默认 Release 签名配置 | 离线备份，不提交，不读取后打印 |
| `~/.frost-story/*.jks` | 秘密 | Android 更新身份 | 丢失后无法覆盖安装未来版本 |
| `CONTENT_MANIFEST_URL` | APK 编译常量 | 指向公开 manifest | 修改需新 APK |
| `site/.openai/hosting.json` | 非秘密配置 | 复用已有 Sites 项目 | 保留原 `project_id`，禁止重复建站 |
| Sites/GitHub write token | 短期秘密 | 推送或部署 | 只用凭证助手/原生连接器，不写 remote URL、文件或回复 |

客户端没有 API key。以后引入服务端或商业 SDK 时，必须先补充权限、数据收集和秘密轮换文档。

## 8. 当前验证基线

以下是功能基线 `b97a962` 的已通过证据；任何代码、依赖、配置、素材或 submodule 指针变化后，都要按影响范围重跑，不能直接复述这些数字。

| 层 | 已有覆盖 | 当前结果 | 是否由主仓库 CI 强制 |
|---|---|---|---|
| 核心引擎 | `frost-merge-core/test/core.test.js` | 4 项通过 | 独立核心 CI |
| 游戏逻辑 | `test/logic.test.js` | 72 项通过 | 是 |
| Android assets 同步 | `test/sync-android.test.js` | 5 项通过 | 是 |
| Android 仓库顺序 | `test/android-build-config.test.js` | 6 项通过 | 是 |
| 游戏浏览器 | `test/e2e.spec.js` | 4 条通过 | 是 |
| 下载站 | `test/site.spec.js` | 移动/桌面 2 条通过 | 否，当前需手动 |
| Android 路径策略 | `ContentPathPolicyTest.kt` | 2 项通过 | 是 |
| Android 构建 | unit + lint + debug assemble | 通过 | 是 |
| Release 构建/签名 | release assemble + apksigner | 通过 | 否，需签名环境 |
| 依赖审计 | `npm audit --audit-level=high` | 0 个已知项 | 否 |
| 真机 | Samsung SM-G9910 / Android 15 | 安装、冷启、教学、商店失败路径、FAB 拖动持久化通过 | 否 |
| 模拟器 | ARM64 `emulator-5554` | 安装与冷启动通过 | 否 |

主仓库绿色 CI：

- https://github.com/JackLee992/frost-story/actions/runs/34669939501
- Web 与 Android job 均成功。

核心绿色 CI：

- https://github.com/JackLee992/frost-merge-core/actions/runs/34668796163

正式 APK：

- 文件名必须保持 `FrostStory-arm64.apk`，下载站按此名称寻找资产。
- SHA-256：`fb4001168464f7582d7ab888f941ac9ddd8b7e2f247cb8c56ee54bcdb5cef4c6`
- v2 signer certificate SHA-256：`eb7b976f28116ca36bd2f414dd0f61670cc4c2073437aef825ab4e7bfdc6cffb`

本机 `artifacts/qa/` 有完整截图过程，但目录默认被 Git 忽略，新的 clone 只有 `.gitkeep`。可长期引用的代表图是已提交到 `site/dist/assets/gameplay-safe-area.png` 的副本。

## 9. Android 开发与真机门禁

本机命令行没有全局 JDK 时使用 Android Studio JBR：

    cd android
    JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew testDebugUnitTest lintDebug assembleDebug

Gradle 的 `preBuild` 会从根目录 `web/` 同步内容。需要单独检查同步脚本时，从仓库根目录运行：

    bash tools/sync_android.sh

真机验收至少执行：

1. `adb devices -l` 确认目标设备状态为 `device`，不是只看到模拟器。
2. 安装本次实际准备交付的 APK，不能拿旧包代替。
3. 强停后冷启动，检查目标进程存活和 AndroidRuntime/Gecko 崩溃日志。
4. 从欢迎页完成生成、合并、订单、融冰、商店和剧情引导。
5. 商店先成功购买，再在余额不足时重复点击；列表不得关闭或跳回顶部。
6. 开启爽玩，拖到另一侧和底部边缘，强停重启后位置必须保持。
7. 检查顶部挖孔、左右边缘、底部手势区没有遮住核心内容。
8. 棋盘不得出现贯穿屏幕的竖条、残影或错误阶级纹理。

模拟器、浏览器 E2E 和历史截图都不能代替这一轮真机结果。设备断开时必须明确写“真机未验证”，不能推断为通过。

## 10. 发布流程

### 10.1 新 APK

1. 在 `android/app/build.gradle.kts` 同时检查并递增 `versionCode`、`versionName`；若 APK 内置新 Web 内容，也更新 `BUNDLED_CONTENT_VERSION`。
2. 跑完整 Web、Android、site 和依赖审计。
3. 使用同一 release keystore 构建：

       cd android
       JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleRelease

4. 对最终 APK 做 `apksigner verify --verbose --print-certs` 和 SHA-256。
5. 在真机上安装并执行第 9 节门禁。
6. 提交并等待 main CI 绿色后再打不可变 tag。
7. GitHub Release 上传资产时使用精确文件名 `FrostStory-arm64.apk` 和对应 `.sha256`。
8. 不强制移动已发布 tag，不用另一个签名密钥覆盖发版。

### 10.2 新内容包

优先使用 GitHub Actions 的 `Publish verified game content` 手动工作流：

    gh workflow run "Publish verified game content" -f version=0.2.0 -f min_app_version_code=1

工作流顺序是：初始化 submodule → 打 ZIP/哈希 → 创建不可变 prerelease 资产 → 最后提交公开 manifest。不能先把 manifest 指向尚未存在的资产。

手工预检：

    bash tools/package_content_update.sh 0.2.0 1

发布前确认：

- 版本严格高于当前 `distribution/content-manifest.json`。
- ZIP 不含 symlink、隐藏路径、submodule 元数据、测试或文档。
- 压缩包不超过 64 MiB；应用端还限制 96 MiB 解压总量、16 MiB 单文件和 512 个文件。
- 真实 APK 下载成功后只提示“下次启动生效”，当前会话不半热切换。

### 10.3 下载站

- 源码在 `site/dist`，页面动态读取 GitHub latest release 和 raw content manifest。
- Sites 项目 ID 已保存在 `site/.openai/hosting.json`；必须复用，禁止调用 create-site 创建重复项目。
- 当前访问模式为 public，生产 URL 是 https://frost-story-download.s419505080.chatgpt.site 。
- 修改页面后先跑两种视口的 site E2E，再用 Sites 原生连接器获取短期源码凭证、推送精确源码、保存版本并部署。
- 短期凭证只能作为单次 Git HTTP header 使用，不得写入 remote URL、Git config 或交接文档。
- 页面依赖 GitHub API，但 API 失败时必须仍保留 latest APK 直链。

### 10.4 核心引擎

- 发布前核心自身 `npm test` 必须绿色。
- 遵循 SemVer；宿主发布固定 tag 或完整 SHA，不能跟随浮动 `main`。
- 核心发布后再更新宿主 submodule，并让两个仓库 CI 都通过。

## 11. 故障记录规则

每次遇到用户可见故障，都在 `docs/04-故障复盘与回归清单.md` 追加一个连续 `FS-xxx`：

- 可观察现象。
- 真正根因，不能只写表象。
- 通用修复和为何放在宿主或核心。
- 最小自动回归。
- 必要的模拟器/真机回归。
- 若是发布问题，记录干净 checkout 或外部服务证据。

先写能失败的测试，再修复。若测试难以自动化，明确写出手工步骤和未覆盖风险，不能把“建议测试”写成“已经通过”。

## 12. 已知风险和测试缺口

这些不是已经修复的问题，不得在交付说明里隐藏：

- 物理设备矩阵目前只有一台 Samsung Android 15；尚未覆盖真实 Android 8/API 26、国产低端机、平板和折叠屏。
- APK 只发布 `arm64-v8a`，约 218 MB；没有 32 位或 x86 正式包。
- 内容包有 HTTPS、大小和 SHA-256 完整性，但 manifest 没有独立非对称签名。GitHub 仓库权限被攻破时，攻击者可同时替换包和哈希。优先考虑在 APK 内固定内容签名公钥。
- 内容更新尚缺“线上 manifest → 下载 → 次启动激活 → 损坏包回退”的全链路自动化/真机测试。
- 固定回环端口被占用时会随机回退，导致不同 origin 下读取不到旧 localStorage。
- 下载站 GitHub API 可能限流；当前只有静态后备链接，没有自建版本服务。
- Android 仍使用 AGP 9 的旧 Kotlin/DSL 兼容开关，Gradle 日志提示需在 AGP 10 前迁移。
- GitHub Actions v4 当前有 Node 运行时/Java action 弃用警告；升级前查官方迁移说明并跑一次完整 CI。
- 没有崩溃上报、性能遥测、云备份或应用商店分发验证。
- “当前未发现漏洞”只表示上述覆盖范围，不是绝对安全保证。

## 13. 建议开发优先级

### P0：发布可靠性

1. 给内容 manifest 增加离线私钥签名、APK 内公钥验证和拒绝测试。
2. 补内容更新端到端测试，包括损坏 ZIP、回退、断网和磁盘不足。
3. 把 site E2E、npm audit 和可重复的 release artifact 检查纳入 CI。
4. 扩充至少 API 26、一个低内存设备和侧边挖孔/折叠屏测试。

### P1：继续内容与体验

1. 按数据驱动方式扩展第 4 章以后剧情，避免把剧情条件硬编码到 UI。
2. 做长时棋盘 soak、低帧率拖拽和内存/节点数监控。
3. 优化 GeckoView/素材体积，评估 App Bundle 或按 ABI 分发。
4. 增加存档版本升级测试，为后续云存档预留明确 schema。

### P2：外围产品能力

账号、云存档、活动、签到、广告/IAP、iOS 壳等必须在用户确认产品方向后另立设计与权限边界，不能为了“对标完整”直接引入跟踪 SDK 或复制竞品内容。

## 14. 完成定义

任何“完成”“已修复”“可发布”结论至少满足：

- 代码和配置落在正确仓库，工作树无意外文件。
- 新故障有可先失败、修复后通过的回归。
- `npm test`、受影响的 Android 任务和核心测试通过。
- 下载站变化跑 site E2E。
- main 与核心相关 CI 均绿色。
- APK 变化验证签名、哈希、安装、冷启动和真机核心路径。
- 内容更新变化验证发布资产先存在、manifest 后切换。
- 文档、版本号、Release 和实际文件一致。
- 最终报告区分自动化、模拟器与物理设备证据，并列出仍未覆盖的风险。

## 15. 相关文档

- `README.md`：项目入口、试玩和常用命令。
- `docs/01-竞品拆解与技术路线.md`：对标证据与原创边界。
- `docs/02-游戏设计GDD.md`：玩法、数值、章节与交互设计。
- `docs/03-竞品玩法对齐验收.md`：已对齐和明确未实现系统。
- `docs/04-故障复盘与回归清单.md`：FS-001 起的根因与防再发门禁。
- `docs/05-核心游戏引擎接入指南.md`：submodule、npm Git tag 和 vendor 接入。
- `android/README.md`：Android Studio、GeckoView 和打包说明。
- `distribution/README.md`：动态内容发布约定。
- `SECURITY.md`：安全边界和私下报告渠道。

接手后的第一条状态更新应说明：当前 HEAD、submodule SHA、工作树是否干净、准备修改的范围，以及将重跑哪些门禁。这样用户能区分“继承的历史结论”和“本轮新证据”。
