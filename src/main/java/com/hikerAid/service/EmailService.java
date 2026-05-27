package com.hikerAid.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String mailUsername;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public boolean isConfigured() {
        return mailUsername != null && !mailUsername.isBlank();
    }

    public void sendFriendInvite(String toEmail, String inviterName)
            throws MessagingException, MailException, UnsupportedEncodingException {
        if (!isConfigured()) {
            throw new IllegalStateException("SMTP not configured — set MAIL_USERNAME and MAIL_PASSWORD env vars");
        }
        log.info("Sending friend invite from {} to {}", inviterName, toEmail);

        MimeMessage mime = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
        helper.setFrom(mailUsername, "HikerAid");
        helper.setTo(toEmail);
        helper.setSubject("HikerAid — " + inviterName + " wants to be your hiking buddy!");
        helper.setText(inviterName + " invited you to join HikerAid as a hiking friend.\n\n"
                + "Sign up with Google at HikerAid and the friendship will be created automatically.\n\n"
                + "Stay safe on the trails!");
        mailSender.send(mime);
        log.info("Friend invite sent successfully to {}", toEmail);
    }

    public void sendEmergencyAlert(String toEmail, String hikerName, double latitude, double longitude)
            throws MessagingException, MailException, UnsupportedEncodingException {
        if (!isConfigured()) {
            throw new IllegalStateException("SMTP not configured — set MAIL_USERNAME and MAIL_PASSWORD env vars");
        }
        String mapsUrl = "https://www.google.com/maps?q=" + latitude + "," + longitude;
        log.warn("EMERGENCY alert from {} — sending to {}", hikerName, toEmail);

        MimeMessage mime = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
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
}
