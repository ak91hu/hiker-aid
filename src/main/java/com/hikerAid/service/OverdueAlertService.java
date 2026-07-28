package com.hikerAid.service;

import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.FriendshipEntity.Status;
import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.TrackingSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class OverdueAlertService {

    private static final Logger log = LoggerFactory.getLogger(OverdueAlertService.class);

    private final TrackingSessionRepository sessionRepository;
    private final FriendshipRepository friendshipRepository;
    private final EmailService emailService;

    public OverdueAlertService(TrackingSessionRepository sessionRepository,
                               FriendshipRepository friendshipRepository,
                               EmailService emailService) {
        this.sessionRepository = sessionRepository;
        this.friendshipRepository = friendshipRepository;
        this.emailService = emailService;
    }

    @Scheduled(fixedDelay = 60000)
    public void checkOverdueSessions() {
        List<TrackingSessionEntity> overdue =
            sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(Instant.now());
        if (overdue.isEmpty()) return;

        for (TrackingSessionEntity s : overdue) {
            if (!emailService.isConfigured()) {
                log.warn("Overdue session {} but email not configured - cannot alert", s.getId());
                continue;
            }

            UserEntity hiker = s.getUser();
            List<FriendshipEntity> friends = friendshipRepository.findAllByUserAndStatus(hiker.getId(), Status.ACCEPTED);
            String expected = s.getExpectedReturn() != null ? s.getExpectedReturn().toString() : null;

            boolean anySent = false;
            for (FriendshipEntity f : friends) {
                UserEntity friend = f.getRequester().getId().equals(hiker.getId())
                    ? f.getAddressee() : f.getRequester();
                try {
                    emailService.sendOverdueAlert(friend.getEmail(), hiker.getName(),
                        s.getLastLat(), s.getLastLon(),
                        s.getLastAccuracyM() != null ? s.getLastAccuracyM() : 0, expected);
                    anySent = true;
                } catch (Exception e) {
                    log.error("Overdue alert email failed for {}: {}", friend.getEmail(), e.getMessage());
                }
            }

            if (anySent || friends.isEmpty()) {
                s.setOverdueAlertSent(true);
                sessionRepository.save(s);
                log.info("Sent overdue alert for session {} to {} friends", s.getId(), friends.size());
            }
        }
    }
}
