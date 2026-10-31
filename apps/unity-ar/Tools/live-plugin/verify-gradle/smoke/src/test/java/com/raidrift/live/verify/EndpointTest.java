package com.raidrift.live.verify;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import org.junit.Test;
import static org.junit.Assert.*;

public class EndpointTest {
    private String endpoint(String url, String key) throws Exception {
        Method method = Class.forName("com.raidrift.live.LiveBridge")
                .getDeclaredMethod("endpoint", String.class, String.class);
        method.setAccessible(true);
        return (String)method.invoke(null, url, key);
    }
    private void reject(String url, String key) throws Exception {
        try { endpoint(url, key); fail("Expected invalid endpoint"); }
        catch (InvocationTargetException expected) { assertNotNull(expected.getCause()); }
    }
    @Test public void twitchAndTls() throws Exception {
        assertEquals("rtmps://live.twitch.tv:443/app/example_test_key",
                endpoint("rtmps://live.twitch.tv:443/app", "example_test_key"));
        assertEquals("rtmp://live.twitch.tv/app/example_test_key",
                endpoint("rtmp://live.twitch.tv/app/", "example_test_key"));
        reject("https://live.twitch.tv/app", "example_test_key");
        reject("rtmp://user:password@host/app", "example_test_key");
        reject("rtmp://host/app", "bad#fragment");
    }
    @Test public void exactSrtOptionUnitsAndDecoding() throws Exception {
        String url = endpoint("srt://relay.example:9000?streamid=%23!%3A%3Ar%3Dtest&latency=1000&pbkeylen=256&passphrase=example-test-phrase", "");
        // RootEncoder parses only the part BEFORE '?' with URI; the decoded
        // query preserves common '#!::' SRT stream IDs.
        assertTrue(url.contains("streamid=#!::r=test"));
    }
    @Test public void validateSrt() throws Exception {
        String url = endpoint("srt://relay.example:9000?streamid=publish%3Atest&latency=1000&pbkeylen=256&passphrase=example-test-phrase", "");
        assertTrue(url.contains("streamid=publish:test"));
        assertTrue(url.contains("latency=1000"));
        reject("srt://relay.example:9000?streamid=test&latency=1000000", "");
        reject("srt://relay.example:9000?streamid=test&pbkeylen=32&passphrase=example-test-phrase", "");
        reject("srt://relay.example:9000?streamid=test&mode=listener", "");
        reject("srt://relay.example:9000?streamid=test&streamid=other", "");
        reject("srt://relay.example:9000?streamid=test", "duplicate");
    }
}
