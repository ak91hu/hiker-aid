package com.hikerAid.service;

import jakarta.mail.*;
import jakarta.mail.internet.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final String TESTMAIL_API = "https://api.testmail.app/api/json";
    private static final String MX_HOST = "mx.testmail.app";

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${hikerAid.testmail-api-key:}")
    private String apiKey;

    @Value("${hikerAid.testmail-namespace:}")
    private String namespace;

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank()
            && namespace != null && !namespace.isBlank();
    }

    public String getNamespace() {
        return namespace;
    }

    public void sendFriendInvite(String toEmail, String inviterName) throws Exception {
        String tag = "invite-" + sanitizeTag(toEmail);
        String subject = "HikerAid — " + inviterName + " wants to be your hiking buddy!";
        String body = inviterName + " invited you to join HikerAid as a hiking friend.\n\n"
                + "Sign up with Google at HikerAid and the friendship will be created automatically.\n\n"
                + "Stay safe on the trails!\n\n"
                + "(Original recipient: " + toEmail + ")";
        sendToTestmail(tag, subject, body);
    }

    public void sendEmergencyAlert(String toEmail, String hikerName, double latitude, double longitude) throws Exception {
        String mapsUrl = "https://www.google.com/maps?q=" + latitude + "," + longitude;
        String tag = "emergency-" + System.currentTimeMillis();
        String subject = "EMERGENCY — " + hikerName + " needs help!";
        String body = "EMERGENCY ALERT from HikerAid\n\n"
                + hikerName + " has triggered an emergency alert and may need immediate help.\n\n"
                + "Current coordinates:\n"
                + "  Latitude:  " + latitude + "\n"
                + "  Longitude: " + longitude + "\n\n"
                + "Google Maps: " + mapsUrl + "\n\n"
                + "Please try to contact them or alert local emergency services.\n"
                + "If you believe this is a real emergency, call your local emergency number (112 / 911 / 999).\n\n"
                + "(Original recipient: " + toEmail + ")";
        sendToTestmail(tag, subject, body);
    }

    public void sendTestEmail() throws Exception {
        String tag = "admin-test-" + System.currentTimeMillis();
        sendToTestmail(tag, "HikerAid Email Test",
                "Test email from the HikerAid admin panel.\nTimestamp: " + java.time.Instant.now());
    }

    private void sendToTestmail(String tag, String subject, String body) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("Testmail.app not configured — set TESTMAIL_NAMESPACE env var");
        }

        String toAddress = tag + "." + namespace + "@inbox.testmail.app";
        log.info("Delivering email to testmail.app: to={}, subject={}", toAddress, subject);

        Properties props = new Properties();
        props.put("mail.smtp.host", MX_HOST);
        props.put("mail.smtp.port", "25");
        props.put("mail.smtp.auth", "false");
        props.put("mail.smtp.starttls.enable", "false");
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props);
        MimeMessage msg = new MimeMessage(session);
        msg.setFrom(new InternetAddress("hikeraid@hikeraid.app", "HikerAid"));
        msg.setRecipient(Message.RecipientType.TO, new InternetAddress(toAddress));
        msg.setSubject(subject, "UTF-8");
        msg.setText(body, "UTF-8");
        msg.setSentDate(new java.util.Date());

        Transport.send(msg);
        log.info("Email delivered to {}", toAddress);
    }

    public Map<String, Object> fetchInbox(String tag) {
        if (!isConfigured()) {
            return Map.of("error", "Testmail.app not configured — set TESTMAIL_NAMESPACE env var");
        }
        try {
            String url = TESTMAIL_API + "?apikey=" + enc(apiKey)
                    + "&namespace=" + enc(namespace)
                    + "&pretty=true&livequery=false";
            if (tag != null && !tag.isBlank()) {
                url += "&tag=" + enc(tag);
            }

            ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return Map.of("error", "Testmail API returned " + response.getStatusCode());
            }

            JsonNode root = objectMapper.readTree(response.getBody());
            String result = root.path("result").asText("");
            if (!"success".equals(result)) {
                return Map.of("error", "Testmail API: " + root.path("message").asText("unknown error"));
            }

            int count = root.path("count").asInt(0);
            List<Map<String, Object>> emails = new ArrayList<>();
            JsonNode emailsNode = root.path("emails");
            if (emailsNode.isArray()) {
                for (int i = 0; i < Math.min(emailsNode.size(), 20); i++) {
                    JsonNode e = emailsNode.get(i);
                    Map<String, Object> m = new HashMap<>();
                    m.put("id", e.path("id").asText());
                    m.put("subject", e.path("subject").asText());
                    m.put("from", e.path("from").asText());
                    m.put("to", e.path("to").asText());
                    m.put("text", e.path("text").asText());
                    m.put("timestamp", e.path("timestamp").asLong());
                    emails.add(m);
                }
            }

            Map<String, Object> resp = new HashMap<>();
            resp.put("success", true);
            resp.put("count", count);
            resp.put("emails", emails);
            resp.put("namespace", namespace);
            return resp;
        } catch (Exception e) {
            log.error("Testmail inbox fetch error: {}", e.getMessage());
            return Map.of("error", "Testmail API error: " + e.getMessage());
        }
    }

    private String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }

    private String sanitizeTag(String input) {
        return input.replaceAll("[^a-zA-Z0-9-]", "-").toLowerCase();
    }
}
