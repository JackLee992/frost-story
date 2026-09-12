pluginManagement {
    repositories {
        // Official repositories must lead: a mirror-side 5xx is terminal for that
        // metadata request and can prevent Gradle from reaching a healthy upstream.
        google()
        mavenCentral()
        gradlePluginPortal()
        // Mainland fallback for upstream 404/rate-limit conditions.
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        // GeckoView（Mozilla 独立浏览器内核）官方 Maven 源
        maven { url = uri("https://maven.mozilla.org/maven2") }
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
    }
}
rootProject.name = "FrostStory"
include(":app")
