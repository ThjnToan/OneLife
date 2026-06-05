plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.onelife.sync"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.onelife.sync"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    // Health Connect (Health Connect app must be installed on the device)
    implementation("androidx.health.connect:connect-client:1.1.0-alpha07")

    // WorkManager for periodic background sync
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Lifecycle for collecting flows from the Health Connect client
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")

    // Material + AppCompat
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // EncryptedSharedPreferences for the ingest token (token is shared
    // secret; the URL and last-sync time are not sensitive so they can
    // stay in the regular prefs file).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
