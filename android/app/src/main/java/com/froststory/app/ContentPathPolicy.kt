package com.froststory.app

/** Shared policy for untrusted URL and ZIP paths used by local game content. */
internal object ContentPathPolicy {
    fun isSafe(raw: String, maxLength: Int, allowTrailingSlash: Boolean = false): Boolean {
        if (raw.isBlank() || raw.length > maxLength || raw.indexOf('\u0000') >= 0) return false
        if (raw.startsWith('/') || raw.contains('\\')) return false
        val path = if (allowTrailingSlash) raw.trimEnd('/') else raw
        if (path.isEmpty() || (!allowTrailingSlash && raw.endsWith('/'))) return false
        return path.split('/').all { segment ->
            segment.isNotEmpty() && segment != "." && segment != ".." && !segment.startsWith('.')
        }
    }
}
