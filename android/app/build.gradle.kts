import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val signingPropertiesFile = file(
    System.getenv("FROST_STORY_SIGNING_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.frost-story/release-signing.properties"
)
val releaseSigning = Properties().apply {
    if (signingPropertiesFile.isFile) signingPropertiesFile.inputStream().use(::load)
}

android {
    namespace = "com.froststory.app"
    compileSdk {
        version = release(37) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.froststory.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "BUNDLED_CONTENT_VERSION", "\"0.2.0\"")
        buildConfigField(
            "String",
            "CONTENT_MANIFEST_URL",
            "\"https://raw.githubusercontent.com/JackLee992/frost-story/main/distribution/content-manifest.json\""
        )
        // 当前发行渠道面向 ARM64 真机；单 ABI 可把 GeckoView 安装包缩小约 2/3。
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        if (signingPropertiesFile.isFile) {
            create("release") {
                storeFile = file(releaseSigning.getProperty("storeFile"))
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    // 独立 Gecko 内核（不依赖系统 WebView），版本可随官方稳定版升级
    implementation("org.mozilla.geckoview:geckoview:155.0.20260903215306")
    testImplementation("junit:junit:4.13.2")
}

val syncWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../web"))
    into(layout.projectDirectory.dir("src/main/assets/web"))
    exclude(
        ".DS_Store",
        "**/.git",
        "js/engine/.github/**",
        "js/engine/docs/**",
        "js/engine/test/**",
        "js/engine/README.md",
        "js/engine/CHANGELOG.md",
        "js/engine/LICENSE",
        "js/engine/package.json",
        "js/engine/package-lock.json"
    )
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) } && !signingPropertiesFile.isFile) {
    throw GradleException(
        "Release signing is not configured. Run ../tools/create_release_keystore.sh or set FROST_STORY_SIGNING_PROPERTIES."
    )
}
