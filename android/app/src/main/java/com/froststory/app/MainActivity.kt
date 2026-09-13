package com.froststory.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import kotlin.math.ceil
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    private lateinit var gecko: GeckoView
    private val session = GeckoSession()
    private lateinit var assetServer: LocalAssetServer
    private lateinit var contentUpdater: ContentUpdateManager
    private var lastBack = 0L
    private var gameLoaded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        immersive()

        // 1) 优先使用已校验的动态内容；没有更新时始终回退到随 APK 打包的版本。
        contentUpdater = ContentUpdateManager(applicationContext)
        assetServer = LocalAssetServer(assets, contentUpdater.activeContentRoot()).also { it.start() }

        // 2) GeckoView 承载 WebGL 游戏
        gecko = GeckoView(this)
        // GeckoView 默认开启 DOM Storage（localStorage 存档），这里只需确保 JS 可用
        session.settings.allowJavascript = true
        session.contentDelegate = object : GeckoSession.ContentDelegate {}
        session.open((application as FrostApp).runtime)
        gecko.setSession(session)
        setContentView(gecko)

        // 背景延伸到全屏，核心内容则使用真机 DisplayCutout / 手势安全区。
        ViewCompat.setOnApplyWindowInsetsListener(gecko) { _, insets ->
            if (!gameLoaded) loadGame(insets)
            insets
        }
        ViewCompat.requestApplyInsets(gecko)
        gecko.postDelayed({
            if (!gameLoaded) loadGame(ViewCompat.getRootWindowInsets(gecko))
        }, 350)

        // 3) 再按一次返回键退出（游戏为单页，弹窗由前端处理）
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (System.currentTimeMillis() - lastBack < 2000) finish()
                else { lastBack = System.currentTimeMillis(); Toast.makeText(this@MainActivity, R.string.exit_prompt, Toast.LENGTH_SHORT).show() }
            }
        })
    }

    private fun loadGame(insets: WindowInsetsCompat?) {
        if (gameLoaded) return
        gameLoaded = true
        val cutout = insets?.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.displayCutout())
        val gestures = insets?.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures())
        val density = resources.displayMetrics.density.coerceAtLeast(1f)
        fun cssPx(a: Int, b: Int) = ceil(max(a, b) / density).toInt()
        val top = cssPx(cutout?.top ?: 0, gestures?.top ?: 0)
        val right = cssPx(cutout?.right ?: 0, gestures?.right ?: 0)
        val bottom = cssPx(cutout?.bottom ?: 0, gestures?.bottom ?: 0)
        val left = cssPx(cutout?.left ?: 0, gestures?.left ?: 0)
        val version = contentUpdater.activeContentVersion()
        session.loadUri(
            assetServer.url("index.html") +
                "?safeTop=$top&safeRight=$right&safeBottom=$bottom&safeLeft=$left" +
                "&contentVersion=$version"
        )
        contentUpdater.checkForUpdate { updatedVersion ->
            runOnUiThread {
                if (!isFinishing && !isDestroyed) {
                    Toast.makeText(
                        this,
                        getString(R.string.content_update_ready, updatedVersion),
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onResume() { super.onResume(); immersive(); session.setActive(true) }
    override fun onPause() { session.setActive(false); super.onPause() }
    override fun onStart() { super.onStart(); session.setActive(true) }
    override fun onStop() { session.setActive(false); super.onStop() }

    override fun onDestroy() {
        try { session.close() } catch (_: Exception) {}
        assetServer.stop()
        contentUpdater.shutdown()
        super.onDestroy()
    }
}
