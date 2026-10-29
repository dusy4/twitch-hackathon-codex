plugins { id("com.android.application") }
android {
    namespace = "world.raidrift.arprobe"
    compileSdk = 37
    defaultConfig {
        applicationId = "world.raidrift.arprobe"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "qa-only"
        ndk { abiFilters += "x86_64" }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies { implementation("com.google.ar:core:1.57.0") }
