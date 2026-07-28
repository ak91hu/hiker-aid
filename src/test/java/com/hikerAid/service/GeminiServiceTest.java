package com.hikerAid.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GeminiServiceTest {

    @Mock
    private RestTemplate restTemplate;

    private ObjectMapper objectMapper;
    private GeminiService geminiService;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        geminiService = new GeminiService(restTemplate, objectMapper);
        ReflectionTestUtils.setField(geminiService, "apiKey", "test-gemini-key");
    }

    @Test
    void isAvailable_ReturnsCorrectFlagBasedOnApiKey() {
        assertTrue(geminiService.isAvailable());

        ReflectionTestUtils.setField(geminiService, "apiKey", "");
        assertFalse(geminiService.isAvailable());

        ReflectionTestUtils.setField(geminiService, "apiKey", null);
        assertFalse(geminiService.isAvailable());
    }

    @Test
    void analyzePerformance_NotAvailable_ReturnsNull() {
        ReflectionTestUtils.setField(geminiService, "apiKey", "");
        assertNull(geminiService.analyzePerformance(Map.of("name", "Test Route")));
    }

    @Test
    void analyzePerformance_Success_ReturnsAiText() {
        String jsonResponse = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      { "text": "Great route pacing and solid elevation profile!" }
                    ]
                  }
                }
              ]
            }
            """;
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(jsonResponse, HttpStatus.OK));

        String result = geminiService.analyzePerformance(Map.of("name", "Test Route", "stats", Map.of("distanceKm", 10)));
        assertNotNull(result);
        assertEquals("Great route pacing and solid elevation profile!", result);
    }

    @Test
    void analyzePerformance_ApiException_ReturnsUnavailableMessage() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenThrow(new RuntimeException("API connection timeout"));

        String result = geminiService.analyzePerformance(Map.of("name", "Test Route"));
        assertNotNull(result);
        assertTrue(result.contains("AI analysis temporarily unavailable"));
        assertTrue(result.contains("API connection timeout"));
    }

    @Test
    void getHikingTip_Success_StripsMarkdown() {
        String jsonResponse = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      { "text": "## Hiking Tip\\n**Always carry extra water** in summer!" }
                    ]
                  }
                }
              ]
            }
            """;
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(jsonResponse, HttpStatus.OK));

        String tip = geminiService.getHikingTip();
        assertNotNull(tip);
        assertFalse(tip.contains("**"));
        assertFalse(tip.contains("##"));
        assertTrue(tip.contains("Always carry extra water in summer!"));
    }

    @Test
    void getHikingTip_Exception_ReturnsNull() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenThrow(new RuntimeException("Rate limit"));

        String tip = geminiService.getHikingTip();
        assertNull(tip);
    }

    @Test
    void testConnection_NotAvailable_ThrowsIllegalStateException() {
        ReflectionTestUtils.setField(geminiService, "apiKey", "");
        assertThrows(IllegalStateException.class, () -> geminiService.testConnection());
    }

    @Test
    void testConnection_PrimaryModelSuccess_ReturnsModelAndResponse() throws Exception {
        String jsonResponse = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      { "text": "Pong" }
                    ]
                  }
                }
              ]
            }
            """;
        when(restTemplate.postForEntity(eq("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key"), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(jsonResponse, HttpStatus.OK));

        String res = geminiService.testConnection();
        assertNotNull(res);
        assertTrue(res.contains("gemini-2.5-flash"));
        assertTrue(res.contains("Pong"));
    }

    @Test
    void testConnection_PrimaryModelFails_FallbackToSecondaryModel() throws Exception {
        String jsonResponse = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      { "text": "Pong from 2.0" }
                    ]
                  }
                }
              ]
            }
            """;
        when(restTemplate.postForEntity(eq("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key"), any(HttpEntity.class), eq(String.class)))
            .thenThrow(new RuntimeException("404 Not Found"));
        when(restTemplate.postForEntity(eq("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-gemini-key"), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(jsonResponse, HttpStatus.OK));

        String res = geminiService.testConnection();
        assertNotNull(res);
        assertTrue(res.contains("gemini-2.0-flash"));
        assertTrue(res.contains("Pong from 2.0"));
    }

    @Test
    void testConnection_AllModelsFail_ThrowsException() {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenThrow(new RuntimeException("API key invalid"));

        Exception ex = assertThrows(Exception.class, () -> geminiService.testConnection());
        assertTrue(ex.getMessage().contains("API key invalid"));
    }

    @Test
    void extractText_SkipsThinkingParts() {
        String jsonResponse = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      { "thought": true, "text": "Let me think about this hike..." },
                      { "text": "Final recommendation: start early." }
                    ]
                  }
                }
              ]
            }
            """;
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>(jsonResponse, HttpStatus.OK));

        String result = geminiService.analyzePerformance(Map.of("name", "Test"));
        assertNotNull(result);
        assertFalse(result.contains("Let me think"));
        assertEquals("Final recommendation: start early.", result);
    }
}
