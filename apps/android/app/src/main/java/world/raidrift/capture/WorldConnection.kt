package world.raidrift.capture

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class Hero(val id: String, val name: String, val x: Float, val y: Float, val animation: String, val target: String? = null, val spawnedAt: Long? = null, val message: String = "")
data class Raid(val id: String, val started: Long, val count: Int, val from: String = "", val test: Boolean = false)
data class ServerTrack(val id: String, val label: String, val box: TrackBox, val confidence: Float, val seenAt: Long)
data class WorldProp(val id: String, val kind: String, val x: Float, val y: Float, val expires: Long)
data class Quest(val title: String, val progress: String, val completed: Boolean, val action: String, val targetClass: String)
data class NativeWorld(
    val roomId: String, val mode: String, val paused: Boolean, val reducedMotion: Boolean, val heroes: List<Hero>, val raid: Raid?,
    val tracks: List<ServerTrack> = emptyList(), val props: List<WorldProp> = emptyList(), val quests: List<Quest> = emptyList()
) {
    companion object {
        private fun text(json: JSONObject, key: String, limit: Int): String? = if (!json.has(key) || json.isNull(key)) null else json.optString(key).take(limit)
        private fun finite(value: Double) = value.isFinite()

        fun parse(raw: String): NativeWorld {
            require(raw.length <= 2_000_000) { "Snapshot exceeds size limit" }
            val json = JSONObject(raw)
            val config = json.getJSONObject("config")
            val array = json.getJSONArray("avatars")
            require(array.length() <= 1000) { "World exceeds character safety limit" }
            val heroes = (0 until array.length()).map { index ->
                val hero = array.getJSONObject(index)
                val id = hero.getString("id")
                val x = hero.getDouble("x"); val y = hero.getDouble("y")
                require(id.length in 1..80 && x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0) { "Invalid character position or identity" }
                val target = text(hero, "target", 200)?.takeIf { it.length in 1..80 }
                val spawned = if (hero.has("spawnedAt") && !hero.isNull("spawnedAt")) hero.optLong("spawnedAt").takeIf { it > 0 } else null
                Hero(id, hero.getString("name").take(40), x.toFloat(), y.toFloat(), hero.optString("animation", "idle").take(40), target, spawned, text(hero, "message", 140) ?: "")
            }
            require(heroes.map { it.id }.toSet().size == heroes.size) { "Duplicate character identity" }
            val raid = json.optJSONObject("raid")?.let { Raid(it.getString("id"), it.getLong("started"), it.optInt("count").coerceIn(0, 1_000_000), it.optString("from", "").take(50), it.optBoolean("test")) }
            // Optional collections are lenient: one malformed entry is skipped instead of failing the world.
            val tracks = json.optJSONArray("tracks")?.let { a -> (0 until minOf(a.length(), 200)).mapNotNull { i -> runCatching {
                val t = a.getJSONObject(i); val box = t.getJSONArray("box")
                val values = (0 until 4).map { box.getDouble(it) }
                require(values.all { finite(it) && it in -0.01..1.01 })
                val id = t.getString("id"); require(id.length in 1..80)
                ServerTrack(id, t.optString("class", "").take(40), TrackBox(values[0].toFloat(), values[1].toFloat(), values[2].toFloat(), values[3].toFloat()),
                    t.optDouble("confidence", 0.0).toFloat().coerceIn(0f, 1f), t.optLong("seenAt"))
            }.getOrNull() } } ?: emptyList()
            val props = json.optJSONArray("props")?.let { a -> (0 until minOf(a.length(), 100)).mapNotNull { i -> runCatching {
                val p = a.getJSONObject(i)
                val x = p.optDouble("x", 0.5); val y = p.optDouble("y", 0.5)
                require(finite(x) && finite(y))
                WorldProp(p.getString("id").take(80), p.optString("kind", "").take(40), x.toFloat().coerceIn(0f, 1f), y.toFloat().coerceIn(0f, 1f), p.optLong("expires"))
            }.getOrNull() } } ?: emptyList()
            val quests = json.optJSONArray("quests")?.let { a -> (0 until minOf(a.length(), 50)).mapNotNull { i -> runCatching {
                val q = a.getJSONObject(i)
                Quest(q.optString("title", "").take(80), if (q.isNull("progress")) "" else q.opt("progress")?.toString()?.take(40) ?: "",
                    q.optBoolean("completed"), text(q, "action", 40) ?: "", text(q, "targetClass", 40) ?: "")
            }.getOrNull() } } ?: emptyList()
            return NativeWorld(json.getString("roomId"), json.optString("mode", "OFFLINE").take(64), config.optBoolean("paused"), config.optBoolean("reducedMotion"), heroes, raid, tracks, props, quests)
        }
    }
}

object ServerAddress {
    /** Tailscale assigns 100.64.0.0/10 (RFC 6598 CGNAT) addresses to tailnet devices. */
    fun isCgnat(octets: List<Int?>): Boolean = octets.size == 4 && octets.all { it != null && it in 0..255 } && octets[0] == 100 && octets[1]!! in 64..127

    fun parse(value: String, allowDebugHttp: Boolean): HttpUrl {
        val url = value.trim().toHttpUrlOrNull() ?: throw IllegalArgumentException("Enter a valid HTTPS server URL")
        require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "Server URL must not contain credentials, query or fragment" }
        val octets = url.host.split('.').map { part ->
            part.takeIf { it.matches(Regex("0|[1-9][0-9]{0,2}")) }?.toIntOrNull()
        }
        val privateIpv4 = octets.size == 4 && octets.all { it != null && it in 0..255 } &&
            (octets[0] == 10 || octets[0] == 172 && octets[1]!! in 16..31 || octets[0] == 192 && octets[1] == 168)
        require(url.isHttps || allowDebugHttp && (privateIpv4 || isCgnat(octets) || url.host in setOf("127.0.0.1", "localhost"))) { "Use HTTPS, or a private/Tailscale IPv4 address for a debug test" }
        return url
    }
}

/** [revoked] is set only when the server rejects the pairing; transient network loss keeps the last world. */
data class ConnectionState(val world: NativeWorld? = null, val message: String = "Local 3D preview · not connected", val authorized: Boolean = false, val pairingRequested: Boolean = false, val revoked: Boolean = false)

internal class ExpiredPairing : IOException()
internal fun nativeWorldRequest(server: HttpUrl, token: String): Request = Request.Builder()
    .url(server.newBuilder().addPathSegments("v1/native/world").build())
    .header("Authorization", "Bearer $token").build()

private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
internal fun nativePostRequest(server: HttpUrl, token: String, path: String, body: JSONObject): Request = Request.Builder()
    .url(server.newBuilder().addPathSegments(path).build())
    .header("Authorization", "Bearer $token")
    .post(body.toString().toRequestBody(JSON_TYPE)).build()

internal fun readNativeWorld(response: Response): NativeWorld {
    if (response.code == 401 || response.code == 403) throw ExpiredPairing()
    if (!response.isSuccessful) throw IOException("World connection returned ${response.code}")
    return NativeWorld.parse(readBounded(response))
}

internal fun readBounded(response: Response, limit: Long = 2_000_000): String {
    val body = response.body
    require(body.contentLength() <= limit) { "Response exceeds size limit" }
    val source = body.source()
    source.request(limit + 1)
    require(source.buffer.size <= limit) { "Response exceeds size limit" }
    return source.buffer.readUtf8()
}

/** Pure parse of GET /v1/debug/pair. */
internal fun parsePairResponse(raw: String): Pair<String?, String> {
    val json = JSONObject(raw)
    val token = json.getString("token").trim()
    require(token.isNotBlank() && token.length <= 4000) { "Test server returned no token" }
    val server = if (json.isNull("server")) null else json.optString("server").takeIf { it.isNotBlank() }
    return server to token
}

class WorldConnection(application: Application) : AndroidViewModel(application) {
    private val client = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    /** Chat may wait on the server's AI planner. */
    private val slowClient = client.newBuilder().readTimeout(30, TimeUnit.SECONDS).build()
    private val mutable = MutableStateFlow(ConnectionState())
    val state = mutable.asStateFlow()
    private val debugMutable = MutableStateFlow<DebugState?>(null)
    val debugState = debugMutable.asStateFlow()
    private val debugErrorMutable = MutableStateFlow("")
    val debugError = debugErrorMutable.asStateFlow()
    private var credentials: Pair<HttpUrl, String>? = null
    private var job: Job? = null
    private var debugJob: Job? = null
    @Volatile private var call: Call? = null
    private var foreground = true
    private val tracksInFlight = AtomicBoolean(false)
    @Volatile var lastTracksResult = "not sent"; private set
    private val prefs = application.getSharedPreferences("raidrift-debug", Context.MODE_PRIVATE)

    /** Debug builds remember the last server URL (and token) so a relaunch reconnects. */
    val savedServer: String? get() = if (BuildConfig.DEBUG) prefs.getString("server", null) else null

    init {
        if (BuildConfig.DEBUG) {
            val server = prefs.getString("server", null); val token = prefs.getString("token", null)
            if (server != null && token != null) runCatching { connect(server, token) }
        }
    }

    fun connect(server: String, token: String) {
        val url = ServerAddress.parse(server, BuildConfig.DEBUG)
        require(token.isNotBlank() && token.length <= 4000) { "Paste the camera pairing token from Creator Studio" }
        require(token.trim().all { it.code in 33..126 }) { "Pairing token contains invalid characters" }
        pause(); mutable.value = ConnectionState(message = "Connecting to your room…", pairingRequested = true); credentials = url to token.trim(); foreground = true
        if (BuildConfig.DEBUG) prefs.edit().putString("server", url.toString().trimEnd('/')).putString("token", token.trim()).apply()
        resume()
    }

    /** Test server only: GET /v1/debug/pair (no auth) and connect with the returned token. */
    fun quickPair(server: String, onResult: (String?) -> Unit) {
        val url = runCatching { ServerAddress.parse(server, BuildConfig.DEBUG) }.getOrElse { onResult(it.message ?: "Invalid server URL"); return }
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    client.newCall(Request.Builder().url(url.newBuilder().addPathSegments("v1/debug/pair").build()).build()).execute().use { response ->
                        if (response.code == 404) throw IOException("Quick pair is disabled on this server (404)")
                        if (!response.isSuccessful) throw IOException("Quick pair returned ${response.code}")
                        parsePairResponse(readBounded(response, 100_000))
                    }
                }
            }
            result.onSuccess { (_, token) ->
                // Keep the URL the phone actually reached; the server's self-reported address may be LAN-only.
                runCatching { connect(url.toString(), token) }.onSuccess { onResult(null) }.onFailure { onResult(it.message ?: "Pairing failed") }
            }.onFailure { onResult(it.message ?: "Quick pair failed · check the server URL and Tailscale") }
        }
    }

    fun resume() {
        foreground = true
        if (job?.isActive == true) return
        val pair = credentials ?: return
        job = viewModelScope.launch {
            while (isActive && foreground) {
                try {
                    val world = withContext(Dispatchers.IO) {
                        val request = nativeWorldRequest(pair.first, pair.second)
                        client.newCall(request).also { call = it }.execute().use { response ->
                            readNativeWorld(response)
                        }
                    }
                    mutable.value = ConnectionState(world, "${world.mode} · ${world.heroes.size} connected characters", true, true)
                    delay(150)
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: ExpiredPairing) {
                    credentials = null
                    if (BuildConfig.DEBUG) prefs.edit().remove("token").apply()
                    mutable.value = ConnectionState(message = "Pairing expired or revoked. Re-pair in Creator Studio.", pairingRequested = true, revoked = true); break
                }
                // A cellular blip must not end a live stream: keep the last world and retry.
                catch (_: Exception) { mutable.value = mutable.value.copy(message = "World connection lost · reconnecting", pairingRequested = true); delay(1200) }
            }
        }
    }
    fun pause() { foreground = false; job?.cancel(); job = null; call?.cancel(); call = null }
    fun startOutput(output: CompositeOutput) {
        val pair = credentials ?: throw IllegalStateException("Pair the room first")
        check(mutable.value.authorized && mutable.value.world?.paused == false) { "An active paired world is required" }
        output.start(pair.first, pair.second)
    }
    fun disconnect() {
        pause(); credentials = null; mutable.value = ConnectionState()
        if (BuildConfig.DEBUG) prefs.edit().remove("token").apply()
    }

    private suspend fun post(path: String, body: JSONObject, http: OkHttpClient = client): Pair<Int, String> {
        val pair = credentials ?: throw IllegalStateException("Pair the room first")
        return withContext(Dispatchers.IO) {
            http.newCall(nativePostRequest(pair.first, pair.second, path, body)).execute().use { it.code to readBounded(it, 500_000) }
        }
    }

    /** POST /v1/native/chat. Plain text is treated as `!rift <text>` by the server. */
    fun chat(text: String, name: String?, onResult: (ChatReply) -> Unit) {
        val clean = text.trim().take(300)
        if (clean.isEmpty()) return
        viewModelScope.launch {
            val reply = runCatching {
                val body = JSONObject().put("text", clean)
                name?.trim()?.takeIf { it.isNotEmpty() }?.let { body.put("name", it.take(40)) }
                val (code, raw) = post("v1/native/chat", body, slowClient)
                ChatReply.parse(code, raw)
            }.getOrElse { ChatReply(false, it.message?.take(120) ?: "Chat failed") }
            onResult(reply)
        }
    }

    /** POST /v1/native/debug/event. */
    fun debugEvent(event: JSONObject, onResult: (String) -> Unit) {
        viewModelScope.launch {
            val message = runCatching {
                val (code, raw) = post("v1/native/debug/event", event)
                when {
                    code == 404 -> "Debug tools disabled on server (404)"
                    code == 401 || code == 403 -> "Debug event rejected ($code)"
                    code !in 200..299 -> "Debug event failed ($code)"
                    else -> JSONObject(raw).let { if (it.optBoolean("ok")) "${event.optString("type")} queued" else it.optString("message", "Refused") }
                }
            }.getOrElse { it.message ?: "Debug event failed" }
            onResult(message)
        }
    }

    /** POST /v1/native/tracks; skipped while a previous post is in flight. */
    fun postTracks(tracks: List<OutgoingTrack>) {
        if (credentials == null || !mutable.value.authorized) return
        if (!tracksInFlight.compareAndSet(false, true)) return
        viewModelScope.launch {
            lastTracksResult = try {
                val (code, _) = post("v1/native/tracks", tracksPayload(tracks))
                if (code in 200..299) "ok · ${tracks.size} tracks" else "HTTP $code"
            } catch (cancel: CancellationException) { throw cancel } catch (e: Exception) { e.message?.take(60) ?: "failed" }
            finally { tracksInFlight.set(false) }
        }
    }

    fun startDebugPolling() {
        if (debugJob?.isActive == true) return
        debugJob = viewModelScope.launch {
            while (isActive) {
                val pair = credentials
                if (pair != null && foreground) {
                    try {
                        val state = withContext(Dispatchers.IO) {
                            val request = Request.Builder().url(pair.first.newBuilder().addPathSegments("v1/native/debug/state").build())
                                .header("Authorization", "Bearer ${pair.second}").build()
                            client.newCall(request).execute().use { response ->
                                if (!response.isSuccessful) throw IOException(if (response.code == 404) "debug/state disabled (404)" else "debug/state HTTP ${response.code}")
                                DebugState.parse(readBounded(response))
                            }
                        }
                        debugMutable.value = state; debugErrorMutable.value = ""
                    } catch (cancel: CancellationException) { throw cancel } catch (e: Exception) { debugErrorMutable.value = e.message ?: "debug/state failed" }
                } else debugErrorMutable.value = "Not paired"
                delay(1000)
            }
        }
    }
    fun stopDebugPolling() { debugJob?.cancel(); debugJob = null }

    override fun onCleared() { disconnectKeepPrefs(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
    private fun disconnectKeepPrefs() { pause(); stopDebugPolling(); credentials = null }
}
