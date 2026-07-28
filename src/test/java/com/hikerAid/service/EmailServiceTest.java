package com.hikerAid.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class EmailServiceTest {

    @Mock
    private RestTemplate restTemplate;

    private ObjectMapper objectMapper;
    private EmailService emailService;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        emailService = new EmailService(restTemplate, objectMapper);
        ReflectionTestUtils.setField(emailService, "resendApiKey", "re_123456789");
        ReflectionTestUtils.setField(emailService, "resendFrom", "HikerAid <onboarding@resend.dev>");
    }

    @Test
    void isConfigured_WhenApiKeyPresent_ReturnsTrue() {
        assertTrue(emailService.isConfigured());
    }

    @Test
    void isConfigured_WhenApiKeyNullOrBlank_ReturnsFalse() {
        ReflectionTestUtils.setField(emailService, "resendApiKey", "");
        assertFalse(emailService.isConfigured());

        ReflectionTestUtils.setField(emailService, "resendApiKey", null);
        assertFalse(emailService.isConfigured());
    }

    @Test
    void sendViaResend_NotConfigured_ThrowsIllegalStateException() {
        ReflectionTestUtils.setField(emailService, "resendApiKey", "");
        assertThrows(IllegalStateException.class, () -> emailService.sendTestEmail("test@example.com"));
    }

    @Test
    void sendFriendInvite_Success() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>("{\"id\":\"msg_123\"}", HttpStatus.OK));

        emailService.sendFriendInvite("friend@example.com", "Alice");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://api.resend.com/emails"), captor.capture(), eq(String.class));

        HttpEntity<Map<String, Object>> entity = captor.getValue();
        Map<String, Object> body = entity.getBody();
        assertNotNull(body);
        assertEquals(List.of("friend@example.com"), body.get("to"));
        assertTrue(((String) body.get("subject")).contains("Alice"));
        assertTrue(((String) body.get("text")).contains("Alice"));
    }

    @Test
    void sendEmergencyAlert_PositiveAccuracy_FormatsCoordinatesAndMeters() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>("{\"id\":\"msg_123\"}", HttpStatus.OK));

        emailService.sendEmergencyAlert("friend@example.com", "Bob", 47.5000001, 19.0000001, 15.4);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://api.resend.com/emails"), captor.capture(), eq(String.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertNotNull(body);
        String text = (String) body.get("text");
        assertTrue(text.contains("Bob"));
        assertTrue(text.contains("47.5000001"));
        assertTrue(text.contains("19.0000001"));
        assertTrue(text.contains("15 meters"));
    }

    @Test
    void sendEmergencyAlert_ZeroAccuracy_FormatsUnknownAccuracy() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>("{\"id\":\"msg_123\"}", HttpStatus.OK));

        emailService.sendEmergencyAlert("friend@example.com", "Bob", 47.5, 19.0, 0.0);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://api.resend.com/emails"), captor.capture(), eq(String.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertNotNull(body);
        String text = (String) body.get("text");
        assertTrue(text.contains("unknown"));
    }

    @Test
    void sendOverdueAlert_WithLocationAndExpectedReturn() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>("{\"id\":\"msg_123\"}", HttpStatus.OK));

        emailService.sendOverdueAlert("friend@example.com", "Charlie", 47.5, 19.0, 5.0, "2026-07-28T18:00:00Z");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://api.resend.com/emails"), captor.capture(), eq(String.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertNotNull(body);
        String text = (String) body.get("text");
        assertTrue(text.contains("Charlie"));
        assertTrue(text.contains("2026-07-28T18:00:00Z"));
        assertTrue(text.contains("maps.google.com"));
    }

    @Test
    void sendOverdueAlert_NullLocation_FormatsNoLocationText() throws Exception {
        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenReturn(new ResponseEntity<>("{\"id\":\"msg_123\"}", HttpStatus.OK));

        emailService.sendOverdueAlert("friend@example.com", "Charlie", null, null, 0.0, null);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<HttpEntity<Map<String, Object>>> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(eq("https://api.resend.com/emails"), captor.capture(), eq(String.class));

        Map<String, Object> body = captor.getValue().getBody();
        assertNotNull(body);
        String text = (String) body.get("text");
        assertTrue(text.contains("No GPS location was recorded"));
    }

    @Test
    void sendViaResend_HttpClientErrorException_ParsesJsonErrorMessage() {
        String jsonError = "{\"message\":\"Domain not verified\"}";
        HttpClientErrorException ex = HttpClientErrorException.create(
            HttpStatus.UNPROCESSABLE_ENTITY, "Unprocessable", new HttpHeaders(), jsonError.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8
        );

        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenThrow(ex);

        RuntimeException thrown = assertThrows(RuntimeException.class, () -> emailService.sendTestEmail("test@example.com"));
        assertTrue(thrown.getMessage().contains("Resend: Domain not verified"));
    }

    @Test
    void sendViaResend_HttpClientErrorException_NonJson_ThrowsGenericStatusCode() {
        HttpClientErrorException ex = HttpClientErrorException.create(
            HttpStatus.BAD_REQUEST, "Bad Request", new HttpHeaders(), "Bad Gateway".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8
        );

        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
            .thenThrow(ex);

        RuntimeException thrown = assertThrows(RuntimeException.class, () -> emailService.sendTestEmail("test@example.com"));
        assertTrue(thrown.getMessage().contains("Resend API error"));
    }
}
