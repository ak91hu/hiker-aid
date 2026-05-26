package com.hikerAid.service;

import com.hikerAid.model.GpxData;
import com.hikerAid.model.TrackPoint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class GpxParserServiceTest {

    private GpxParserService parser;

    @BeforeEach
    void setUp() {
        parser = new GpxParserService();
    }

    @Test
    void parsesBasicTrack() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1" creator="test">
              <trk><name>Test Route</name><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>200</ele><time>2024-01-01T08:00:00Z</time></trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>250</ele><time>2024-01-01T08:30:00Z</time></trkpt>
                <trkpt lat="47.52" lon="19.02"><ele>300</ele><time>2024-01-01T09:00:00Z</time></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));

        assertEquals("Test Route", data.name());
        assertEquals(1, data.segments().size());
        assertEquals(3, data.segments().get(0).size());

        TrackPoint first = data.segments().get(0).get(0);
        assertEquals(47.5, first.lat(), 0.001);
        assertEquals(19.0, first.lon(), 0.001);
        assertEquals(200.0, first.elevation());
        assertNotNull(first.time());
    }

    @Test
    void parsesRoutePointsWhenNoTracks() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <rte><name>Route Only</name>
                <rtept lat="47.5" lon="19.0"><ele>100</ele></rtept>
                <rtept lat="47.6" lon="19.1"><ele>200</ele></rtept>
              </rte>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals("Route Only", data.name());
        assertEquals(1, data.segments().size());
        assertEquals(2, data.segments().get(0).size());
    }

    @Test
    void parsesWaypoints() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <wpt lat="47.5" lon="19.0">
                <name>Summit</name>
                <desc>The top</desc>
                <sym>Summit</sym>
              </wpt>
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                <trkpt lat="47.6" lon="19.1"><ele>200</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(1, data.waypoints().size());
        assertEquals("Summit", data.waypoints().get(0).name());
        assertEquals("The top", data.waypoints().get(0).description());
    }

    @Test
    void handlesEmptySegments() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><name>Empty</name><trkseg></trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals("Empty", data.name());
        assertTrue(data.segments().isEmpty());
    }

    @Test
    void handlesNoElevation() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"></trkpt>
                <trkpt lat="47.6" lon="19.1"></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertNull(data.segments().get(0).get(0).elevation());
    }

    @Test
    void defaultsToUnnamedRoute() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                <trkpt lat="47.6" lon="19.1"><ele>200</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals("Unnamed Route", data.name());
    }

    @Test
    void rejectsXxeAttack() {
        String xxe = """
            <?xml version="1.0"?>
            <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
            <gpx version="1.1"><trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><name>&xxe;</name></trkpt>
            </trkseg></trk></gpx>
            """;

        assertThrows(Exception.class, () -> parser.parse(toStream(xxe)));
    }

    @Test
    void skipsMalformedPoints() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                <trkpt lat="bad" lon="19.1"><ele>200</ele></trkpt>
                <trkpt lat="47.6" lon="19.1"><ele>300</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(2, data.segments().get(0).size());
    }

    private ByteArrayInputStream toStream(String s) {
        return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8));
    }
}
