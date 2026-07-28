package com.hikerAid.controller;

import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Contract tests for the hiker-specific personalization boundaries exposed by
 * the GPX analysis endpoint.
 */
class GpxApiPersonalizationTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        var controller = new GpxApiController(new GpxParserService(), new RouteAnalysisService());
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void oversizedPackIsClampedToSupportedLoadInsteadOfProducingExtremeResults() throws Exception {
        double noPackCalories = caloriesForPack("0");
        double maximumPackCalories = caloriesForPack("60");
        double oversizedPackCalories = caloriesForPack("999");

        org.junit.jupiter.api.Assertions.assertTrue(maximumPackCalories > noPackCalories,
            "A supported pack load must increase the energy estimate");
        org.junit.jupiter.api.Assertions.assertEquals(maximumPackCalories, oversizedPackCalories, 0.01,
            "Loads above the supported range must be clamped to 60 kg");
    }

    @Test
    void personalizedPaceIsClampedToSafeCalibrationRange() throws Exception {
        long fastestSupported = movingMinutesForPace("3.0");
        long unrealisticPace = movingMinutesForPace("99");
        long slowestSupported = movingMinutesForPace("0.3");
        long nonPositivePaceFallsBackToFitness = movingMinutesForPace("0");

        org.junit.jupiter.api.Assertions.assertEquals(fastestSupported, unrealisticPace,
            "An unrealistic pace factor must be clamped to the calibrated maximum");
        org.junit.jupiter.api.Assertions.assertTrue(slowestSupported > fastestSupported);
        org.junit.jupiter.api.Assertions.assertTrue(nonPositivePaceFallsBackToFitness > fastestSupported,
            "A non-positive pace factor must use the selected fitness level");
    }

    @Test
    void validAnalysisReturnsTurnaroundAndPointOfNoReturnSafetyData() throws Exception {
        mockMvc.perform(multipart("/api/analyze")
                .file(routeFile())
                .param("startHour", "17")
                .param("startMinute", "30"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.safety.turnaroundDistanceKm").isNumber())
            .andExpect(jsonPath("$.safety.pointOfNoReturnKm").isNumber())
            .andExpect(jsonPath("$.safety.safetyBufferMinutes").value(30))
            .andExpect(jsonPath("$.safety.cumForwardMinutes").isArray())
            .andExpect(jsonPath("$.safety.cumReturnMinutes").isArray());
    }

    private double caloriesForPack(String pack) throws Exception {
        String body = mockMvc.perform(multipart("/api/analyze").file(routeFile()).param("pack", pack))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return new tools.jackson.databind.ObjectMapper()
            .readTree(body).path("stats").path("estimatedCalories").asDouble();
    }

    private long movingMinutesForPace(String pace) throws Exception {
        String body = mockMvc.perform(multipart("/api/analyze").file(routeFile()).param("paceFactor", pace))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return new tools.jackson.databind.ObjectMapper()
            .readTree(body).path("stats").path("estimatedTimeMinutes").asLong();
    }

    private MockMultipartFile routeFile() {
        String gpx = """
            <?xml version="1.0"?>
            <gpx version="1.1"><trk><name>Personalized Ridge Traverse</name><trkseg>
              <trkpt lat="47.500" lon="19.000"><ele>250</ele></trkpt>
              <trkpt lat="47.520" lon="19.010"><ele>650</ele></trkpt>
              <trkpt lat="47.540" lon="19.020"><ele>900</ele></trkpt>
              <trkpt lat="47.560" lon="19.030"><ele>500</ele></trkpt>
            </trkseg></trk></gpx>
            """;
        return new MockMultipartFile("file", "ridge.gpx", "application/gpx+xml",
            gpx.getBytes(StandardCharsets.UTF_8));
    }
}
