package com.froststory.app

import android.app.Application
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

/**
 * 全局唯一 GeckoRuntime：自带独立 Gecko 内核，与系统 WebView 版本解耦，保证机型一致性。
 */
class FrostApp : Application() {
    // Application.onCreate() 会在 Gecko 的 GPU、内容与崩溃辅助进程中执行。
    // 仅由主进程的 Activity 首次访问时创建 Runtime，避免子进程递归启动 Gecko。
    val runtime: GeckoRuntime by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        val settings = GeckoRuntimeSettings.Builder()
            .javaScriptEnabled(true)
            .webManifest(false)
            .aboutConfigEnabled(false)
            .build()
        GeckoRuntime.create(this, settings)
    }
}
