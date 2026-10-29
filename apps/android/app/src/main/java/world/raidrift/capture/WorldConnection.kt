package world.raidrift.capture

import androidx.lifecycle.ViewModel
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
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class Hero(val id: String, val name: String, val x: Float, val y: Float, val animation: String)
data class Raid(val id: String, val started: Long, val count: Int, val from: String = "")
data class NativeWorld(val roomId: String, val mode: String, val paused: Boolean, val reducedMotion: Boolean, val heroes: List<Hero>, val raid: Raid?) {
    companion object {
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
                Hero(id, hero.getString("name").take(40), x.toFloat(), y.toFloat(), hero.optString("animation", "idle").take(40))
            }
            require(heroes.map { it.id }.toSet().size == heroes.size) { "Duplicate character identity" }
            val raid = json.optJSONObject("raid")?.let { Raid(it.getString("id"), it.getLong("started"), it.optInt("count").coerceIn(0, 1_000_000), it.optString("from", "").take(50)) }
            return NativeWorld(json.getString("roomId"), json.optString("mode", "OFFLINE").take(64), config.optBoolean("paused"), config.optBoolean("reducedMotion"), heroes, raid)
        }
    }
}

object ServerAddress {
    fun parse(value: String, allowDebugHttp: Boolean): HttpUrl {
        val url = value.trim().toHttpUrlOrNull() ?: throw IllegalArgumentException("Enter a valid HTTPS server URL")
        require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "Server URL must not contain credentials, query or fragment" }
        val octets = url.host.split('.').map { part ->
            part.takeIf { it.matches(Regex("0|[1-9][0-9]{0,2}")) }?.toIntOrNull()
        }
        val privateIpv4 = octets.size == 4 && octets.all { it != null && it in 0..255 } &&
            (octets[0] == 10 || octets[0] == 172 && octets[1]!! in 16..31 || octets[0] == 192 && octets[1] == 168)
        require(url.isHttps || allowDebugHttp && (privateIpv4 || url.host in setOf("127.0.0.1", "localhost"))) { "Use HTTPS, or your laptop's private IPv4 address for a debug LAN test" }
        return url
    }
}

/** [revoked] is set only when the server rejects the pairing; transient network loss keeps the last world. */
data class ConnectionState(val world: NativeWorld? = null, val message: String = "Local 3D preview · not connected", val authorized: Boolean = false, val pairingRequested: Boolean = false, val revoked: Boolean = false)

internal class ExpiredPairing : IOException()
internal fun nativeWorldRequest(server: HttpUrl, token: String): Request = Request.Builder()
    .url(server.newBuilder().addPathSegments("v1/native/world").build())
    .header("Authorization", "Bearer $token").build()

internal fun readNativeWorld(response: Response): NativeWorld {
    if (response.code == 401 || response.code == 403) throw ExpiredPairing()
    if (!response.isSuccessful) throw IOException("World connection returned ${response.code}")
    val body = response.body
    require(body.contentLength() <= 2_000_000) { "Snapshot exceeds size limit" }
    val source = body.source()
    source.request(2_000_001)
    require(source.buffer.size <= 2_000_000) { "Snapshot exceeds size limit" }
    return NativeWorld.parse(source.buffer.readUtf8())
}

class WorldConnection : ViewModel() {
    private val client = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    private val mutable = MutableStateFlow(ConnectionState())
    val state = mutable.asStateFlow()
    private var credentials: Pair<HttpUrl, String>? = null
    private var job: Job? = null
    @Volatile private var call: Call? = null
    private var foreground = true
    fun connect(server: String, token: String) {
        val url = ServerAddress.parse(server, BuildConfig.DEBUG)
        require(token.isNotBlank() && token.length <= 4000) { "Paste the camera pairing token from Creator Studio" }
        require(token.trim().all { it.code in 33..126 }) { "Pairing token contains invalid characters" }
        pause(); mutable.value = ConnectionState(message = "Connecting to your room…", pairingRequested = true); credentials = url to token.trim(); foreground = true; resume()
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
                catch (_: ExpiredPairing) { credentials = null; mutable.value = ConnectionState(message = "Pairing expired or revoked. Re-pair in Creator Studio.", pairingRequested = true, revoked = true); break }
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
    fun disconnect() { pause(); credentials = null; mutable.value = ConnectionState() }
    override fun onCleared() { disconnect(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
}
