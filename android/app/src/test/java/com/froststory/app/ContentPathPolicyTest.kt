package com.froststory.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentPathPolicyTest {
    @Test
    fun acceptsNormalNestedGameAssets() {
        assertTrue(ContentPathPolicy.isSafe("js/engine/src/action-result.js", 1024))
        assertTrue(ContentPathPolicy.isSafe("assets/img/items/fire_1.png", 1024))
        assertTrue(ContentPathPolicy.isSafe("assets/img/", 1024, allowTrailingSlash = true))
    }

    @Test
    fun rejectsTraversalAbsoluteHiddenAndMalformedPaths() {
        val rejected = listOf(
            "../secret", "assets/../../secret", "/absolute", "assets\\secret",
            ".git", "js/engine/.git/config", "assets//item.png", "assets/./item.png",
            "assets/item.png/", "assets/\u0000item.png"
        )
        rejected.forEach { path ->
            assertFalse("must reject $path", ContentPathPolicy.isSafe(path, 1024))
        }
        assertFalse(ContentPathPolicy.isSafe("a".repeat(1025), 1024))
    }
}
