package com.hikerAid.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.*;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final String RESEND_API = "https://api.resend.com/emails";
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${hikerAid.resend-api-key:}")
    private String resendApiKey;

    @Value("${hikerAid.resend-from:HikerAid <onboarding@resend.dev>}")
    private String resendFrom;

    public boolean isConfigured() {
        return resendApiKey != null && !resendApiKey.isBlank();
    }

    // ── Sending via Resend ──────────────────────────────────────────────

    public void sendFriendInvite(String toEmail, String inviterName) throws Exception {
        String subject = inviterName + " wants you on their hiking team!";
        String body = "Hey there,\n\n"
                + inviterName + " uses HikerAid to plan safer hikes and wants you as a trail buddy.\n\n"
                + "What is HikerAid?\n"
                + "A free app that analyzes hiking routes - turnaround times, daylight margins,\n"
                + "difficulty scoring, and real-time GPS tracking. When friends are connected,\n"
                + "the app can send your GPS coordinates in an emergency.\n\n"
                + "How to connect:\n"
                + "1. Open https://hikeraid.onrender.com\n"
                + "2. Sign in with Google\n"
                + "3. The friendship with " + inviterName + " will be created automatically\n"
                + "4. You'll appear in each other's emergency contact list\n\n"
                + "No cost, no installation - it runs in your browser and works offline.\n\n"
                + "Stay safe on the trails,\n"
                + "The HikerAid Team\n"
                + "https://hikeraid.onrender.com";
        sendViaResend(toEmail, subject, body);
    }

    public void sendEmergencyAlert(String toEmail, String hikerName,
                                   double latitude, double longitude, double accuracyM) throws Exception {
        String lat = String.format("%.7f", latitude);
        String lon = String.format("%.7f", longitude);
        String mapsUrl = "https://www.google.com/maps?q=" + lat + "," + lon;
        String accuracy = accuracyM > 0 ? String.format("%.0f", accuracyM) + " meters" : "unknown";
        String subject = "EMERGENCY - " + hikerName + " needs help on the trail!";
        String body = "--- EMERGENCY ALERT ---\n\n"
                + hikerName + " has triggered an emergency alert from HikerAid.\n"
                + "They may be injured, lost, or in danger and need immediate help.\n\n"
                + "LOCATION\n"
                + "  Latitude:  " + lat + "\n"
                + "  Longitude: " + lon + "\n"
                + "  Accuracy:  " + accuracy + "\n\n"
                + "  >> Open in Google Maps:\n"
                + "  >> " + mapsUrl + "\n\n"
                + "WHAT TO DO\n"
                + "  1. Try calling " + hikerName + " directly\n"
                + "  2. If no answer, call local emergency services:\n"
                + "     Europe: 112  |  US/Canada: 911  |  UK: 999\n"
                + "  3. Share the coordinates above with rescuers\n"
                + "  4. Open the map link above to see the exact location\n\n"
                + "This alert was sent automatically by HikerAid.\n"
                + "https://hikeraid.onrender.com\n"
                + "If you believe this was sent in error, please still verify.";
        sendViaResend(toEmail, subject, body);
    }

    public void sendTestEmail(String toEmail) throws Exception {
        String subject = "HikerAid - Email System Test";
        String body = "This is a test email from the HikerAid admin panel.\n\n"
                + "If you're reading this, the email system is working correctly.\n\n"
                + "Sent at: " + java.time.Instant.now() + "\n"
                + "Provider: Resend.com\n\n"
                + "https://hikeraid.onrender.com";
        sendViaResend(toEmail, subject, body);
    }

    private void sendViaResend(String to, String subject, String body) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("Resend not configured - set RESEND_API_KEY env var");
        }

        log.info("Sending email via Resend: to={}, subject={}", to, subject);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + resendApiKey);

        Map<String, Object> payload = new HashMap<>();
        payload.put("from", resendFrom);
        payload.put("to", List.of(to));
        payload.put("subject", subject);
        payload.put("text", body);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);

        try {
            ResponseEntity<String> response = restTemplate.postForEntity(RESEND_API, entity, String.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Email sent successfully to {}", to);
            } else {
                throw new RuntimeException("Resend API returned " + response.getStatusCode());
            }
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            String errBody = e.getResponseBodyAsString();
            log.error("Resend API error {}: {}", e.getStatusCode(), errBody);
            try {
                JsonNode err = objectMapper.readTree(errBody);
                throw new RuntimeException("Resend: " + err.path("message").asText(errBody));
            } catch (RuntimeException re) { throw re; }
            catch (Exception ignored) {}
            throw new RuntimeException("Resend API error: " + e.getStatusCode());
        }
    }

}
