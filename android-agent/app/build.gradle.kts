plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.collectish.agent"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.collectish.agent"
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1"
    }
}

kotlin { jvmToolchain(17) }
