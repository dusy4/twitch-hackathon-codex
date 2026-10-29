plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "world.raidrift.capture"
    compileSdk = 37
    defaultConfig {
        applicationId = "world.raidrift.capture.android"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0-dev"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
abstract class PrepareCharacterAssets : DefaultTask() {
    @get:org.gradle.api.tasks.InputDirectory abstract val sourceDirectory: DirectoryProperty
    @get:org.gradle.api.tasks.InputFile abstract val scriptFile: RegularFileProperty
    @get:org.gradle.api.tasks.OutputDirectory abstract val outputDirectory: DirectoryProperty
    @get:javax.inject.Inject abstract val execution: org.gradle.process.ExecOperations
    @org.gradle.api.tasks.TaskAction fun prepare() {
        execution.exec {
            commandLine("node", scriptFile.get().asFile.absolutePath, sourceDirectory.get().asFile.absolutePath, outputDirectory.dir("kaykit").get().asFile.absolutePath)
        }
    }
}
val prepareCharacterAssets = tasks.register<PrepareCharacterAssets>("prepareCharacterAssets") {
    sourceDirectory.set(file("../../web/public/models/kaykit"))
    scriptFile.set(rootProject.file("../../scripts/prepare-native-models.mjs"))
    outputDirectory.set(layout.buildDirectory.dir("generated/characterAssets"))
}
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(prepareCharacterAssets, PrepareCharacterAssets::outputDirectory)
}
tasks.register("writeRuntimeDependencyList") {
    val destination = layout.buildDirectory.file("reports/runtime-dependencies.txt")
    outputs.file(destination)
    doLast {
        val coordinates = configurations.getByName("debugRuntimeClasspath").incoming.resolutionResult.allComponents.mapNotNull {
            (it.id as? org.gradle.api.artifacts.component.ModuleComponentIdentifier)?.let { id -> "${id.group}:${id.module}:${id.version}" }
        }.distinct().sorted()
        destination.get().asFile.apply { parentFile.mkdirs(); writeText(coordinates.joinToString("\n")) }
    }
}
kotlin { jvmToolchain(21); compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21) } }
dependencies {
    implementation("io.github.sceneview:arsceneview:4.62.0")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
