# RootEncoder 2.8.1 logs some server replies even with setLogs(false).
# The custom launcher template enables R8 in BOTH build types. Strip all Log
# calls, including their Throwable argument, so replies cannot leak ingest keys.
-assumenosideeffects class android.util.Log {
    public static int *(...) return 0;
    public static boolean isLoggable(...) return false;
}
# Preserve Unity/Niantic reflection/JNI contracts. Allow call optimization so
# the rule above takes effect, but do not shrink or rename app/dependency APIs.
-keep,allowoptimization class ** { *; }
# Ktor 3.5.2's optional JVM debugger probe catches Throwable and returns false
# on Android; java.lang.management intentionally does not exist there.
-dontwarn java.lang.management.ManagementFactory
-dontwarn java.lang.management.RuntimeMXBean
