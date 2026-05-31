package com.hikerAid.repository;

import com.hikerAid.entity.TrackingSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface TrackingSessionRepository extends JpaRepository<TrackingSessionEntity, Long> {
    Optional<TrackingSessionEntity> findByToken(String token);
    List<TrackingSessionEntity> findByUserIdAndActiveTrue(Long userId);
    List<TrackingSessionEntity> findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(Instant cutoff);
}
