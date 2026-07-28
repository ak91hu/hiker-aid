package com.hikerAid.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestTemplate;

import java.net.URI;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class RoutePlannerControllerTest {

    @Mock
    private RestTemplate restTemplate;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        RoutePlannerController controller = new RoutePlannerController(restTemplate);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void plan_PointsSizeLessThanTwo_Returns400() throws Exception {
        String body = "{\"points\": [[47.5, 19.0]]}";
        mockMvc.perform(post("/api/route/plan")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Provide between 2 and 50 points"));
    }

    @Test
    void plan_CoordinatesOutOfRange_Returns400() throws Exception {
        String body = "{\"points\": [[95.0, 19.0], [47.5, 19.1]]}";
        mockMvc.perform(post("/api/route/plan")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Coordinates out of range"));
    }

    @Test
    void plan_BRouterConnectionFailure_Returns502() throws Exception {
        String body = "{\"points\": [[47.5, 19.0], [47.6, 19.1]]}";
        when(restTemplate.getForEntity(any(URI.class), eq(String.class)))
            .thenThrow(new RuntimeException("BRouter network down"));

        mockMvc.perform(post("/api/route/plan")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadGateway())
            .andExpect(jsonPath("$.error").value("Routing service unavailable. Please try again."));
    }

    @Test
    void plan_ValidPoints_QueriesBRouterAndReturnsGpx() throws Exception {
        String body = "{\"points\": [[47.5, 19.0], [47.6, 19.1]], \"mode\": \"hike\"}";
        String fakeGpx = "<gpx><trk><name>BRouter</name></trk></gpx>";

        when(restTemplate.getForEntity(any(URI.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(fakeGpx, HttpStatus.OK));

        mockMvc.perform(post("/api/route/plan")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gpx").value(fakeGpx));
    }
}
