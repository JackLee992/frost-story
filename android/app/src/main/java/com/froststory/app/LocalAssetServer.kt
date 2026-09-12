package com.froststory.app

import android.content.res.AssetManager
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * 仅绑定回环地址的静态资源服务器。
 *
 * 固定端口让 Gecko 的 origin 跨启动保持一致，因此 localStorage 存档不会因为随机端口丢失。
 * 外部内容必须先由 [ContentUpdateManager] 完成 HTTPS、大小、SHA-256 与 ZIP 路径校验。
 */
class LocalAssetServer(
    private val assets: AssetManager,
    private val contentRoot: File? = null
) {
    @Volatile private var socket: ServerSocket? = null
    val port: Int get() = socket?.localPort ?: 0

    private val pool = ThreadPoolExecutor(
        2,
        8,
        20L,
        TimeUnit.SECONDS,
        ArrayBlockingQueue(128),
        { task -> Thread(task, "asset-http-worker").apply { isDaemon = true } }
    )

    private val mime = mapOf(
        ".html" to "text/html; charset=utf-8",
        ".js" to "application/javascript; charset=utf-8",
        ".mjs" to "application/javascript; charset=utf-8",
        ".css" to "text/css; charset=utf-8",
        ".json" to "application/json; charset=utf-8",
        ".png" to "image/png",
        ".jpg" to "image/jpeg",
        ".jpeg" to "image/jpeg",
        ".webp" to "image/webp",
        ".svg" to "image/svg+xml",
        ".wav" to "audio/wav",
        ".mp3" to "audio/mpeg",
        ".ogg" to "audio/ogg",
        ".ttf" to "font/ttf",
        ".woff2" to "font/woff2",
        ".ico" to "image/x-icon"
    )

    fun start() {
        val server = bindServer(PORT) ?: bindServer(0)
            ?: throw IllegalStateException("Unable to bind the local game server")
        socket = server
        Thread({
            while (!server.isClosed) {
                val client = try { server.accept() } catch (_: Exception) { break }
                try {
                    pool.execute { handle(client) }
                } catch (_: RejectedExecutionException) {
                    try { client.close() } catch (_: Exception) {}
                }
            }
        }, "asset-http").apply { isDaemon = true }.start()
    }

    private fun bindServer(candidatePort: Int): ServerSocket? {
        val candidate = ServerSocket()
        return try {
            candidate.reuseAddress = true
            candidate.bind(InetSocketAddress("127.0.0.1", candidatePort), 16)
            candidate
        } catch (_: Exception) {
            try { candidate.close() } catch (_: Exception) {}
            null
        }
    }

    fun url(path: String = ""): String = "http://127.0.0.1:$port/$path"

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 5000
            val input = BufferedInputStream(client.getInputStream())
            val requestLine = readLine(input, MAX_LINE_BYTES) ?: return
            var headerBytes = 0
            var headerCount = 0
            while (true) {
                val line = readLine(input, MAX_LINE_BYTES) ?: return
                if (line.isEmpty()) break
                headerBytes += line.length
                headerCount++
                if (headerBytes > MAX_HEADER_BYTES || headerCount > MAX_HEADERS) {
                    send(client, 431, "Request Header Fields Too Large", null)
                    return
                }
            }

            val parts = requestLine.split(' ')
            val method = parts.getOrNull(0)?.uppercase()
            if (parts.size != 3 || (method != "GET" && method != "HEAD")) {
                send(client, 405, "Method Not Allowed", null)
                return
            }
            val target = parts[1]
            if (!target.startsWith('/') || target.length > MAX_TARGET_BYTES) {
                send(client, 400, "Bad Request", null)
                return
            }
            var path = URLDecoder.decode(target.substringBefore('?'), Charsets.UTF_8.name()).trimStart('/')
            if (path.isEmpty()) path = "index.html"
            if (!safePath(path)) {
                send(client, 403, "Forbidden", null)
                return
            }

            val bytes = readResource(path)
            if (bytes == null) {
                send(client, 404, "Not Found", null)
                return
            }
            val extension = path.substringAfterLast('.', "").lowercase().let { ".$it" }
            val type = mime[extension] ?: "application/octet-stream"
            send(client, 200, "OK", if (method == "HEAD") null else bytes, type, bytes.size)
        } catch (_: Exception) {
            // 无效或中断的本地请求不应影响游戏主进程。
        } finally {
            try { client.close() } catch (_: Exception) {}
        }
    }

    private fun safePath(path: String): Boolean {
        return ContentPathPolicy.isSafe(path, MAX_TARGET_BYTES)
    }

    private fun readResource(path: String): ByteArray? {
        val updated = contentRoot?.resolve(path)
        if (updated != null) {
            val rootPath = contentRoot.canonicalFile.toPath()
            val file = updated.canonicalFile
            if (!file.toPath().startsWith(rootPath) || !file.isFile || file.length() > MAX_RESOURCE_BYTES) return null
            return file.inputStream().use { readLimited(it, MAX_RESOURCE_BYTES) }
        }
        return try {
            assets.open("web/$path").use { readLimited(it, MAX_RESOURCE_BYTES) }
        } catch (_: Exception) {
            null
        }
    }

    private fun readLimited(input: InputStream, limit: Long): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > limit) return null
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun readLine(input: InputStream, limit: Int): String? {
        val output = ByteArrayOutputStream()
        while (output.size() <= limit) {
            val value = input.read()
            if (value < 0) {
                return if (output.size() == 0) null else output.toString(Charsets.US_ASCII.name())
            }
            if (value == '\n'.code) {
                return output.toString(Charsets.US_ASCII.name()).trimEnd('\r')
            }
            output.write(value)
        }
        throw IllegalArgumentException("HTTP line too long")
    }

    private fun send(
        client: Socket,
        code: Int,
        reason: String,
        body: ByteArray?,
        type: String = "text/plain; charset=utf-8",
        contentLength: Int = body?.size ?: 0
    ) {
        val output: OutputStream = client.getOutputStream()
        val headers = StringBuilder()
        headers.append("HTTP/1.1 $code $reason\r\n")
        headers.append("Content-Type: $type\r\n")
        headers.append("Content-Length: $contentLength\r\n")
        headers.append("Connection: close\r\n")
        headers.append("Cache-Control: no-store\r\n")
        headers.append("X-Content-Type-Options: nosniff\r\n")
        headers.append("Referrer-Policy: no-referrer\r\n")
        headers.append(
            "Content-Security-Policy: default-src 'self'; script-src 'self'; " +
                "style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; " +
                "font-src 'self'; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
                "frame-ancestors 'none'\r\n\r\n"
        )
        output.write(headers.toString().toByteArray(Charsets.UTF_8))
        if (body != null) output.write(body)
        output.flush()
    }

    fun stop() {
        try { socket?.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    companion object {
        const val PORT = 17843
        private const val MAX_LINE_BYTES = 2048
        private const val MAX_TARGET_BYTES = 1024
        private const val MAX_HEADER_BYTES = 16 * 1024
        private const val MAX_HEADERS = 64
        private const val MAX_RESOURCE_BYTES = 16L * 1024L * 1024L
    }
}
