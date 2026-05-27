package com.hikerAid.controller;

import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class GpxApiSecurityTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        GpxApiController controller = new GpxApiController(
            new GpxParserService(), new RouteAnalysisService());
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void rejectsXxeInUpload() throws Exception {
        String xxe = """
            <?xml version="1.0"?>
            <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
            <gpx version="1.1"><trk><trkseg>
              <trkpt lat="47.5" lon="19.0"><name>&xxe;</name></trkpt>
            </trkseg></trk></gpx>
            """;
        MockMultipartFile file = new MockMultipartFile("file", "xxe.gpx", "application/gpx+xml", xxe.getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsOversizeWeight() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "r.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file).param("weight", "999"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Weight must be between 20 and 300 kg"));
    }

    @Test
    void rejectsNegativeWeight() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "r.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file).param("weight", "-10"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsFileWithWrongExtension() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "route.xml", "application/xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Only .gpx files are supported"));
    }

    @Test
    void heightDefaultsGracefully() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "r.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stats.estimatedCalories").isNumber());
    }

    @Test
    void handlesEmptyTrack() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>
            """;
        MockMultipartFile file = new MockMultipartFile("file", "empty.gpx", "application/gpx+xml", gpx.getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stats.distanceKm").value(0));
    }

    @Test
    void handlesRoutePointsInsteadOfTracks() throws Exception {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <rte><name>Route Only</name>
                <rtept lat="47.5" lon="19.0"><ele>100</ele></rtept>
                <rtept lat="47.51" lon="19.01"><ele>200</ele></rtept>
                <rtept lat="47.52" lon="19.02"><ele>300</ele></rtept>
              </rte>
            </gpx>
            """;
        MockMultipartFile file = new MockMultipartFile("file", "route.gpx", "application/gpx+xml", gpx.getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Route Only"))
            .andExpect(jsonPath("$.stats.distanceKm").isNumber())
            .andExpect(jsonPath("$.stats.hasElevationData").value(true));
    }

    private String validGpx() {
        return """
            <?xml version="1.0"?>
            <gpx version="1.1"><trk><name>Test</name><trkseg>
              <trkpt lat="47.5" lon="19.0"><ele>200</ele></trkpt>
              <trkpt lat="47.51" lon="19.01"><ele>250</ele></trkpt>
              <trkpt lat="47.52" lon="19.02"><ele>300</ele></trkpt>
            </trkseg></trk></gpx>
            """;
    }
}
