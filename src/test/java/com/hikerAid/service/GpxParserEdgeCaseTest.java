package com.hikerAid.service;

import com.hikerAid.model.GpxData;
import com.hikerAid.model.TrackPoint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class GpxParserEdgeCaseTest {

    private GpxParserService parser;

    @BeforeEach
    void setUp() {
        parser = new GpxParserService();
    }

    @Test
    void parsesCadenceExtension() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele>
                  <extensions><cad>85</cad></extensions>
                </trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>200</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(85, data.segments().get(0).get(0).cadence());
        assertNull(data.segments().get(0).get(1).cadence());
    }

    @Test
    void handlesMultipleSegments() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><name>Multi Seg</name>
                <trkseg>
                  <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                  <trkpt lat="47.51" lon="19.01"><ele>200</ele></trkpt>
                </trkseg>
                <trkseg>
                  <trkpt lat="47.6" lon="19.1"><ele>300</ele></trkpt>
                  <trkpt lat="47.61" lon="19.11"><ele>400</ele></trkpt>
                </trkseg>
              </trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(2, data.segments().size());
        assertEquals(2, data.segments().get(0).size());
        assertEquals(2, data.segments().get(1).size());
    }

    @Test
    void handlesMultipleTracksInOneFile() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><name>Track 1</name><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>200</ele></trkpt>
              </trkseg></trk>
              <trk><name>Track 2</name><trkseg>
                <trkpt lat="48.5" lon="20.0"><ele>300</ele></trkpt>
                <trkpt lat="48.51" lon="20.01"><ele>400</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(2, data.segments().size());
    }

    @Test
    void parsesTimestamps() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele><time>2024-06-15T08:00:00Z</time></trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>200</ele><time>2024-06-15T09:30:00Z</time></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertNotNull(data.segments().get(0).get(0).time());
        assertTrue(data.segments().get(0).get(0).time().contains("2024"));
    }

    @Test
    void handlesNegativeElevation() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="31.5" lon="35.5"><ele>-420</ele></trkpt>
                <trkpt lat="31.51" lon="35.51"><ele>-400</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(-420.0, data.segments().get(0).get(0).elevation());
    }

    @Test
    void handlesDescriptionAndCreator() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1" creator="Garmin Edge 530">
              <metadata><name>My Hike</name><desc>A beautiful trail</desc></metadata>
              <trk><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>200</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals("My Hike", data.name());
        assertEquals("A beautiful trail", data.description());
        assertEquals("Garmin Edge 530", data.creator());
    }

    @Test
    void handlesVeryLargeCoordinates() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><trkseg>
                <trkpt lat="89.999" lon="179.999"><ele>8000</ele></trkpt>
                <trkpt lat="-89.999" lon="-179.999"><ele>0</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        GpxData data = parser.parse(toStream(gpx));
        assertEquals(2, data.segments().get(0).size());
        assertEquals(89.999, data.segments().get(0).get(0).lat(), 0.001);
    }

    @Test
    void rejectsXxeBillionLaughsVariant() {
        String xxe = """
            <?xml version="1.0"?>
            <!DOCTYPE lolz [
              <!ENTITY lol "lol">
              <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">
            ]>
            <gpx version="1.1"><trk><trkseg>
              <trkpt lat="47.5" lon="19.0"><name>&lol2;</name></trkpt>
            </trkseg></trk></gpx>
            """;

        assertThrows(Exception.class, () -> parser.parse(toStream(xxe)));
    }

    private ByteArrayInputStream toStream(String s) {
        return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8));
    }
}
