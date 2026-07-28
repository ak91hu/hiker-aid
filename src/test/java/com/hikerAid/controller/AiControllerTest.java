package com.hikerAid.controller;

import com.hikerAid.service.GeminiService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class AiControllerTest {

    @Mock
    private GeminiService geminiService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        AiController controller = new AiController(geminiService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void analyze_GeminiUnavailable_ReturnsAvailableFalse() throws Exception {
        when(geminiService.isAvailable()).thenReturn(false);

        mockMvc.perform(post("/api/ai-analysis")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Trail\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.available").value(false));
    }

    @Test
    void analyze_GeminiSuccess_ReturnsAvailableTrueAndAnalysis() throws Exception {
        when(geminiService.isAvailable()).thenReturn(true);
        when(geminiService.analyzePerformance(anyMap())).thenReturn("Excellent steep climb control.");

        mockMvc.perform(post("/api/ai-analysis")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Trail\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.available").value(true))
            .andExpect(jsonPath("$.analysis").value("Excellent steep climb control."));
    }

    @Test
    void tip_GeminiUnavailable_ReturnsAvailableFalse() throws Exception {
        when(geminiService.isAvailable()).thenReturn(false);

        mockMvc.perform(get("/api/ai-tip"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.available").value(false))
            .andExpect(jsonPath("$.reason").value("no-key"));
    }

    @Test
    void tip_GeminiSuccess_ReturnsAvailableTrueAndTip() throws Exception {
        when(geminiService.isAvailable()).thenReturn(true);
        when(geminiService.getHikingTip()).thenReturn("Always bring extra layer.");

        mockMvc.perform(get("/api/ai-tip"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.available").value(true))
            .andExpect(jsonPath("$.tip").value("Always bring extra layer."));
    }
}
