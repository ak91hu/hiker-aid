package com.hikerAid.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final String TESTMAIL_API = "https://api.testmail.app/api/json";
    private static final String TESTMAIL_SMTP = "smtp.testmail.app";
    private static final int TESTMAIL_PORT = 587;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${hikerAid.testmail-api-key:}")
    private String testmailApiKey;

    @Value("${hikerAid.testmail-namespace:}")
    private String testmailNamespace;

    private final org.springframework.mail.javamail.JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String mailUsername;

    public EmailService(org.springframework.mail.javamail.JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public boolean isConfigured() {
        return mailUsername != null && !mailUsername.isBlank();
    }

    public boolean isTestmailConfigured() {
        return testmailApiKey != null && !testmailApiKey.isBlank()
            && testmailNamespace != null && !testmailNamespace.isBlank();
    }

    public String getTestmailNamespace() {
        return testmailNamespace;
    }

    public void sendFriendInvite(String toEmail, String inviterName) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("SMTP not configured — set MAIL_USERNAME and MAIL_PASSWORD env vars");
        }
        log.info("Sending friend invite from {} to {}", inviterName, toEmail);

        var mime = mailSender.createMimeMessage();
        var helper = new org.springframework.mail.javamail.MimeMessageHelper(mime, false, "UTF-8");
        helper.setFrom(mailUsername, "HikerAid");
        helper.setTo(toEmail);
        helper.setSubject("HikerAid — " + inviterName + " wants to be your hiking buddy!");
        helper.setText(inviterName + " invited you to join HikerAid as a hiking friend.\n\n"
                + "Sign up with Google at HikerAid and the friendship will be created automatically.\n\n"
                + "Stay safe on the trails!");
        mailSender.send(mime);
        log.info("Friend invite sent successfully to {}", toEmail);
    }

    public void sendEmergencyAlert(String toEmail, String hikerName, double latitude, double longitude) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("SMTP not configured — set MAIL_USERNAME and MAIL_PASSWORD env vars");
        }
        String mapsUrl = "https://www.google.com/maps?q=" + latitude + "," + longitude;
        log.warn("EMERGENCY alert from {} — sending to {}", hikerName, toEmail);

        var mime = mailSender.createMimeMessage();
        var helper = new org.springframework.mail.javamail.MimeMessageHelper(mime, false, "UTF-8");
        helper.setFrom(mailUsername, "HikerAid Emergency");
        helper.setTo(toEmail);
        helper.setSubject("EMERGENCY — " + hikerName + " needs help!");
        helper.setText("EMERGENCY ALERT from HikerAid\n\n"
                + hikerName + " has triggered an emergency alert and may need immediate help.\n\n"
                + "Current coordinates:\n"
                + "  Latitude:  " + latitude + "\n"
                + "  Longitude: " + longitude + "\n\n"
                + "Google Maps: " + mapsUrl + "\n\n"
                + "Please try to contact them or alert local emergency services.\n"
                + "If you believe this is a real emergency, call your local emergency number (112 / 911 / 999).");
        mailSender.send(mime);
        log.warn("EMERGENCY alert sent to {}", toEmail);
    }

    public void sendTestEmail(String tag, String subject, String body) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("SMTP not configured");
        }
        if (!isTestmailConfigured()) {
            throw new IllegalStateException("Testmail.app not configured — set TESTMAIL_API_KEY and TESTMAIL_NAMESPACE");
        }
        String toEmail = tag + "." + testmailNamespace + "@inbox.testmail.app";
        log.info("Sending test email to {}", toEmail);

        var mime = mailSender.createMimeMessage();
        var helper = new org.springframework.mail.javamail.MimeMessageHelper(mime, false, "UTF-8");
        helper.setFrom(mailUsername, "HikerAid Test");
        helper.setTo(toEmail);
        helper.setSubject(subject);
        helper.setText(body);
        mailSender.send(mime);
        log.info("Test email sent to {}", toEmail);
    }

    public Map<String, Object> fetchTestmailInbox(String tag) {
        if (!isTestmailConfigured()) {
            return Map.of("error", "Testmail.app not configured");
        }
        try {
            String url = TESTMAIL_API + "?apikey=" + enc(testmailApiKey)
                    + "&namespace=" + enc(testmailNamespace)
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
                return Map.of("error", "Testmail API error: " + root.path("message").asText("unknown"));
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
                    m.put("from_parsed", e.path("from_parsed").toString());
                    emails.add(m);
                }
            }

            Map<String, Object> resp = new HashMap<>();
            resp.put("success", true);
            resp.put("count", count);
            resp.put("emails", emails);
            resp.put("namespace", testmailNamespace);
            return resp;
        } catch (Exception e) {
            log.error("Testmail API error: {}", e.getMessage());
            return Map.of("error", "Testmail API error: " + e.getMessage());
        }
    }

    private String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
