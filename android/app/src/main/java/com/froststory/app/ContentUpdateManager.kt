package com.froststory.app

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import androidx.core.content.edit
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream
import javax.net.ssl.HttpsURLConnection

/**
 * 下载并校验纯游戏内容包。原生代码仍只能通过签名 APK 更新。
 *
 * 更新包经过 HTTPS 主机白名单、声明大小、SHA-256、ZIP 路径、文件数与解压体积校验，
 * 验证完成后才原子切换版本标记。正在运行的会话继续使用启动时捕获的旧目录，下一次
 * 启动才加载新版本，因此不会出现半更新页面。
 */
class ContentUpdateManager(context: Context) {
    private val appContext = context.applicationContext
    private val root = File(appContext.filesDir, "game-content")
    private val versions = File(root, "versions")
    private val preferences = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "content-updater").apply { isDaemon = true }
    }

    init {
        versions.mkdirs()
        cleanupInactive(activeVersionOrNull())
    }

    fun activeContentVersion(): String = activeVersionOrNull() ?: BuildConfig.BUNDLED_CONTENT_VERSION

    fun activeContentRoot(): File? {
        val version = activeVersionOrNull() ?: return null
        return versionDirectory(version).takeIf(::isValidContentRoot)
    }

    @SuppressLint("UseKtx")
    fun checkForUpdate(onReady: (String) -> Unit) {
        executor.execute {
            var temporaryArchive: File? = null
            var staging: File? = null
            try {
                val manifest = fetchManifest()
                val current = activeContentVersion()
                if (!isNewerVersion(manifest.version, current)) return@execute
                if (manifest.minAppVersionCode > BuildConfig.VERSION_CODE) {
                    Log.i(TAG, "Content ${manifest.version} requires a newer app")
                    return@execute
                }

                val destination = versionDirectory(manifest.version)
                if (!isValidContentRoot(destination)) {
                    temporaryArchive = File(root, "${UUID.randomUUID()}.zip.part")
                    downloadArchive(manifest, temporaryArchive)
                    staging = File(versions, ".staging-${UUID.randomUUID()}")
                    extractVerifiedArchive(temporaryArchive, staging)
                    if (!isValidContentRoot(staging)) throw UpdateException("required files are missing")
                    if (destination.exists()) destination.deleteRecursively()
                    if (!staging.renameTo(destination)) throw UpdateException("could not activate extracted directory")
                    staging = null
                }

                if (!preferences.edit().putString(KEY_ACTIVE_VERSION, manifest.version).commit()) {
                    throw UpdateException("could not persist active version")
                }
                Log.i(TAG, "Content ${manifest.version} is ready")
                onReady(manifest.version)
            } catch (error: Exception) {
                Log.w(TAG, "Content update skipped: ${error.message}")
            } finally {
                temporaryArchive?.delete()
                staging?.deleteRecursively()
            }
        }
    }

    fun shutdown() {
        executor.shutdownNow()
    }

    private fun fetchManifest(): RemoteManifest {
        val connection = openHttps(BuildConfig.CONTENT_MANIFEST_URL)
        return try {
            val bytes = connection.inputStream.use { readLimited(it, MAX_MANIFEST_BYTES) }
            val json = JSONObject(bytes.toString(Charsets.UTF_8))
            if (json.getInt("schema") != 1) throw UpdateException("unsupported manifest schema")
            val version = json.getString("version")
            val archiveUrl = json.getString("archiveUrl")
            val sha256 = json.getString("sha256").lowercase()
            val size = json.getLong("size")
            val minAppVersionCode = json.optInt("minAppVersionCode", 1)
            if (!VERSION_PATTERN.matches(version)) throw UpdateException("invalid version")
            if (!SHA_PATTERN.matches(sha256)) throw UpdateException("invalid SHA-256")
            if (size !in 1..MAX_ARCHIVE_BYTES) throw UpdateException("invalid archive size")
            validateHttpsUrl(archiveUrl)
            RemoteManifest(version, archiveUrl, sha256, size, minAppVersionCode)
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadArchive(manifest: RemoteManifest, destination: File) {
        val connection = openHttps(manifest.archiveUrl)
        try {
            val declaredLength = connection.contentLengthLong
            if (declaredLength > 0 && declaredLength != manifest.size) {
                throw UpdateException("archive Content-Length mismatch")
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                destination.outputStream().buffered().use { output ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > manifest.size || total > MAX_ARCHIVE_BYTES) {
                            throw UpdateException("archive exceeds declared size")
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            if (total != manifest.size) throw UpdateException("archive size mismatch")
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (!MessageDigest.isEqual(actual.toByteArray(), manifest.sha256.toByteArray())) {
                throw UpdateException("archive SHA-256 mismatch")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun extractVerifiedArchive(archive: File, staging: File) {
        if (staging.exists()) staging.deleteRecursively()
        if (!staging.mkdirs()) throw UpdateException("could not create staging directory")
        val rootPath = staging.canonicalFile.toPath()
        var files = 0
        var total = 0L
        ZipInputStream(BufferedInputStream(archive.inputStream())).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = entry.name
                if (!ContentPathPolicy.isSafe(name, MAX_ENTRY_NAME, allowTrailingSlash = entry.isDirectory)) {
                    throw UpdateException("unsafe ZIP entry")
                }
                val target = File(staging, name).canonicalFile
                if (!target.toPath().startsWith(rootPath)) throw UpdateException("ZIP path traversal")
                if (entry.isDirectory) {
                    if (!target.mkdirs() && !target.isDirectory) throw UpdateException("could not create directory")
                } else {
                    files++
                    if (files > MAX_FILES) throw UpdateException("too many files")
                    target.parentFile?.let {
                        if (!it.mkdirs() && !it.isDirectory) throw UpdateException("could not create parent")
                    }
                    var entryBytes = 0L
                    target.outputStream().buffered().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val count = zip.read(buffer)
                            if (count < 0) break
                            entryBytes += count
                            total += count
                            if (entryBytes > MAX_ENTRY_BYTES || total > MAX_UNPACKED_BYTES) {
                                throw UpdateException("unpacked content exceeds limit")
                            }
                            output.write(buffer, 0, count)
                        }
                    }
                }
                zip.closeEntry()
            }
        }
    }

    private fun openHttps(rawUrl: String): HttpsURLConnection {
        var url = validateHttpsUrl(rawUrl)
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            val connection = url.openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json, application/zip;q=0.9, */*;q=0.1")
            connection.setRequestProperty("User-Agent", "FrostStory/${BuildConfig.VERSION_NAME}")
            val code = connection.responseCode
            if (code in REDIRECT_CODES) {
                val location = connection.getHeaderField("Location")
                    ?: throw UpdateException("redirect without Location")
                connection.disconnect()
                if (redirectCount >= MAX_REDIRECTS) throw UpdateException("too many redirects")
                url = validateHttpsUrl(URL(url, location).toString())
            } else {
                if (code != HttpsURLConnection.HTTP_OK) {
                    connection.errorStream?.close()
                    connection.disconnect()
                    throw UpdateException("HTTP $code")
                }
                return connection
            }
        }
        throw UpdateException("too many redirects")
    }

    private fun validateHttpsUrl(rawUrl: String): URL {
        val url = URL(rawUrl)
        if (url.protocol != "https" || url.userInfo != null || url.port !in listOf(-1, 443)) {
            throw UpdateException("only HTTPS update URLs are allowed")
        }
        if (url.host.lowercase() !in ALLOWED_HOSTS) throw UpdateException("update host is not allowed")
        return url
    }

    private fun readLimited(input: java.io.InputStream, limit: Long): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > limit) throw UpdateException("response exceeds limit")
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun activeVersionOrNull(): String? {
        val version = preferences.getString(KEY_ACTIVE_VERSION, null) ?: return null
        if (!VERSION_PATTERN.matches(version) || !isValidContentRoot(versionDirectory(version))) {
            preferences.edit { remove(KEY_ACTIVE_VERSION) }
            return null
        }
        return version
    }

    private fun isValidContentRoot(directory: File): Boolean {
        if (!directory.isDirectory) return false
        return REQUIRED_FILES.all { relative -> File(directory, relative).isFile }
    }

    private fun versionDirectory(version: String) = File(versions, version)

    private fun cleanupInactive(activeVersion: String?) {
        versions.listFiles()?.forEach { child ->
            if (child.name != activeVersion) child.deleteRecursively()
        }
        root.listFiles()?.forEach { child ->
            if (child.isFile && child.name.endsWith(".part")) child.delete()
        }
    }

    private fun isNewerVersion(candidate: String, current: String): Boolean {
        val left = candidate.split('.', '-', '_')
        val right = current.split('.', '-', '_')
        val count = maxOf(left.size, right.size)
        for (index in 0 until count) {
            val a = left.getOrElse(index) { "0" }
            val b = right.getOrElse(index) { "0" }
            val comparison = if (a.toLongOrNull() != null && b.toLongOrNull() != null) {
                a.toLong().compareTo(b.toLong())
            } else {
                a.compareTo(b, ignoreCase = true)
            }
            if (comparison != 0) return comparison > 0
        }
        return false
    }

    private data class RemoteManifest(
        val version: String,
        val archiveUrl: String,
        val sha256: String,
        val size: Long,
        val minAppVersionCode: Int
    )

    private class UpdateException(message: String) : Exception(message)

    companion object {
        private const val TAG = "ContentUpdate"
        private const val PREFS = "verified_content"
        private const val KEY_ACTIVE_VERSION = "active_version"
        private const val MAX_MANIFEST_BYTES = 64L * 1024L
        private const val MAX_ARCHIVE_BYTES = 64L * 1024L * 1024L
        private const val MAX_UNPACKED_BYTES = 96L * 1024L * 1024L
        private const val MAX_ENTRY_BYTES = 16L * 1024L * 1024L
        private const val MAX_ENTRY_NAME = 240
        private const val MAX_FILES = 512
        private const val MAX_REDIRECTS = 5
        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val READ_TIMEOUT_MS = 15_000
        private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
        private val VERSION_PATTERN = Regex("[0-9A-Za-z][0-9A-Za-z._-]{0,63}")
        private val SHA_PATTERN = Regex("[0-9a-f]{64}")
        private val ALLOWED_HOSTS = setOf(
            "raw.githubusercontent.com",
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com"
        )
        private val REQUIRED_FILES = listOf(
            "index.html",
            "css/style.css",
            "js/main.js",
            "config/story.json",
            "vendor/pixi.min.js",
            "vendor/pixi-unsafe-eval.min.js"
        )
    }
}
