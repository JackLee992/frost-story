pluginManagement {
    repositories {
        // Maven Central occasionally rate-limits mainland/HK Cloudflare edges with a
        // synthetic 404. Keep deterministic mirrors first and the official repos as
        // fallbacks so Android Studio and CI can both resolve the plugin classpath.
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        google()
        mavenCentral()
        // GeckoView（Mozilla 独立浏览器内核）官方 Maven 源
        maven { url = uri("https://maven.mozilla.org/maven2") }
    }
}
rootProject.name = "FrostStory"
include(":app")
