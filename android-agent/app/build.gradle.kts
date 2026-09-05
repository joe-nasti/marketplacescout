plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val collectishKeystore = System.getenv("COLLECTISH_KEYSTORE_FILE")
val collectishStorePassword = System.getenv("COLLECTISH_KEYSTORE_PASSWORD")
val collectishKeyAlias = System.getenv("COLLECTISH_KEY_ALIAS")
val collectishKeyPassword = System.getenv("COLLECTISH_KEY_PASSWORD")
val hasCollectishSigning = listOf(
    collectishKeystore,
    collectishStorePassword,
    collectishKeyAlias,
    collectishKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.collectish.agent"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.collectish.agent"
        minSdk = 28
        targetSdk = 35
        versionCode = 58
        versionName = "0.2.38"
    }

    signingConfigs {
        if (hasCollectishSigning) {
            create("collectishRelease") {
                storeFile = file(collectishKeystore!!)
                storePassword = collectishStorePassword
                keyAlias = collectishKeyAlias
                keyPassword = collectishKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (hasCollectishSigning) {
                signingConfig = signingConfigs.getByName("collectishRelease")
            }
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.15.0")
}

kotlin { jvmToolchain(17) }
