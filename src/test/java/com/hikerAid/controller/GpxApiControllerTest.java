package com.hikerAid.controller;

import com.hikerAid.model.*;
import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class GpxApiControllerTest {

    private MockMvc mockMvc;
    private GpxParserService gpxParser;
    private RouteAnalysisService routeAnalysis;

    @BeforeEach
    void setUp() {
        gpxParser = new GpxParserService();
        routeAnalysis = new RouteAnalysisService();
        GpxApiController controller = new GpxApiController(gpxParser, routeAnalysis);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void healthEndpointReturnsOk() throws Exception {
        mockMvc.perform(get("/api/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ok"))
            .andExpect(jsonPath("$.app").value("HikerAid"));
    }

    @Test
    void analyzeRejectsEmptyFile() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "empty.gpx", "application/gpx+xml", new byte[0]);

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("No file provided"));
    }

    @Test
    void analyzeRejectsNonGpxFile() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "data.txt", "text/plain", "hello".getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Only .gpx files are supported"));
    }

    @Test
    void analyzeRejectsInvalidWeight() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "route.gpx", "application/gpx+xml",
            minimalGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file).param("weight", "5"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Weight must be between 20 and 300 kg"));
    }

    @Test
    void analyzeAcceptsValidGpx() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "route.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file)
                .param("weight", "70")
                .param("fitness", "3")
                .param("startHour", "8")
                .param("startMinute", "0"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Test Route"))
            .andExpect(jsonPath("$.stats.distanceKm").isNumber())
            .andExpect(jsonPath("$.stats.elevationGainM").isNumber())
            .andExpect(jsonPath("$.stats.estimatedTimeMinutes").isNumber())
            .andExpect(jsonPath("$.stats.difficulty").isString())
            .andExpect(jsonPath("$.safety").exists())
            .andExpect(jsonPath("$.safety.sunsetEstimate").isString())
            .andExpect(jsonPath("$.trackPoints").isArray())
            .andExpect(jsonPath("$.gradientSegments").isArray())
            .andExpect(jsonPath("$.elevationProfile").isArray());
    }

    @Test
    void analyzeHandlesMalformedGpx() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "bad.gpx", "application/gpx+xml",
            "not xml at all".getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Could not parse GPX file — please check the file is valid"));
    }

    @Test
    void analyzeFitnessClampedHigh() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "route.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file).param("fitness", "99"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.safety.fitnessLabel").value("Very fit"));
    }

    @Test
    void analyzeFitnessClampedLow() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "route.gpx", "application/gpx+xml",
            validGpx().getBytes());

        mockMvc.perform(multipart("/api/analyze").file(file).param("fitness", "-5"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.safety.fitnessLabel").value("Beginner"));
    }

    private String minimalGpx() {
        return """
            <?xml version="1.0"?>
            <gpx version="1.1"><trk><trkseg>
              <trkpt lat="47.5" lon="19.0"><ele>100</ele></trkpt>
            </trkseg></trk></gpx>
            """;
    }

    private String validGpx() {
        return """
            <?xml version="1.0"?>
            <gpx version="1.1">
              <trk><name>Test Route</name><trkseg>
                <trkpt lat="47.5" lon="19.0"><ele>200</ele></trkpt>
                <trkpt lat="47.51" lon="19.01"><ele>250</ele></trkpt>
                <trkpt lat="47.52" lon="19.02"><ele>300</ele></trkpt>
                <trkpt lat="47.53" lon="19.03"><ele>280</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;
    }
}
