package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class RelayEndpointTest {
    @Test fun acceptsRelayPublisherFormats() {
        listOf("srt://relay.example:9000?streamid=publish:raidrift", "srt://relay.example:4000/live/stream/key", "rtmps://relay.example/live/private-key", "rtmp://127.0.0.1:1935/live/test").forEach {
            assertEquals(it, RelayEndpoint.parse(it).url)
        }
    }
    @Test fun rejectsUnsupportedBondingAndAmbiguousOrIncompleteEndpoints() {
        listOf("srtla://relay.example:5000/key", "https://relay.example/live/key", "srt://relay.example?streamid=key", "srt://relay.example:0?streamid=key", "srt://relay.example:9000", "srt://relay.example:9000?streamid=key&mode=listener", "rtmps://relay.example/live", "rtmps://user:secret@relay.example/live/key", "srt://relay.example:9000?streamid=key#secret").forEach {
            assertThrows(IllegalArgumentException::class.java) { RelayEndpoint.parse(it) }
        }
    }
    @Test fun validationErrorsNeverEchoPrivateStreamKeys() {
        val secret = "PRIVATE-INGEST-KEY"
        val error = assertThrows(IllegalArgumentException::class.java) { RelayEndpoint.parse("srtla://relay.example:5000/$secret") }
        assertFalse(error.message.orEmpty().contains(secret))
    }
    @Test fun adaptsStandardSrtUnitsWithoutChangingPrivateCredentials() {
        assertEquals("srt://relay.example:9000?streamid=publish%3Alive%2Fqa&latency=201&passphrase=private%26phrase&pbkeylen=256",
            RelayEndpoint.parse("srt://relay.example:9000?streamid=publish%3Alive%2Fqa&latency=200001&passphrase=private%26phrase&pbkeylen=32").url)
    }
    @Test fun rejectsAmbiguousUnitsAndEncryptionThatWouldOtherwiseSilentlyDisable() {
        listOf("latency=200", "latency=NaN", "latency=5000001", "latency=200000&latency=300000", "passphrase=short", "passphrase=", "pbkeylen=32", "passphrase=privatephrase&pbkeylen=256", "enforcedencryption=true", "pass%70hrase=ignored").forEach {
            assertThrows(IllegalArgumentException::class.java) { RelayEndpoint.parse("srt://relay.example:9000?streamid=publish:qa&$it") }
        }
    }
}
