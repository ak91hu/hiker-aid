package com.hikerAid.service;

import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.FriendshipEntity.Status;
import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.TrackingSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class OverdueAlertServiceTest {

    @Mock
    private TrackingSessionRepository sessionRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private EmailService emailService;

    @InjectMocks
    private OverdueAlertService overdueAlertService;

    private UserEntity hiker;
    private UserEntity friend1;
    private UserEntity friend2;
    private TrackingSessionEntity session;

    @BeforeEach
    void setUp() {
        hiker = new UserEntity("google-hiker", "hiker@example.com", "Hiker John", "pic.jpg");
        hiker.setId(1L);

        friend1 = new UserEntity("google-friend1", "friend1@example.com", "Friend One", "pic1.jpg");
        friend1.setId(2L);

        friend2 = new UserEntity("google-friend2", "friend2@example.com", "Friend Two", "pic2.jpg");
        friend2.setId(3L);

        session = new TrackingSessionEntity();
        session.setId(10L);
        session.setUser(hiker);
        session.setActive(true);
        session.setOverdueAlertSent(false);
        session.setExpectedReturn(Instant.now().minusSeconds(300));
        session.setLastLat(47.5);
        session.setLastLon(19.0);
        session.setLastAccuracyM(10.0);
    }

    @Test
    void checkOverdueSessions_NoOverdueSessions() throws Exception {
        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(Collections.emptyList());

        overdueAlertService.checkOverdueSessions();

        verify(sessionRepository, never()).save(any());
        verify(emailService, never()).sendOverdueAlert(anyString(), anyString(), anyDouble(), anyDouble(), anyDouble(), any());
    }

    @Test
    void checkOverdueSessions_SessionFound_EmailNotConfigured() throws Exception {
        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(List.of(session));
        when(emailService.isConfigured()).thenReturn(false);

        overdueAlertService.checkOverdueSessions();

        verify(sessionRepository, never()).save(any());
        verify(emailService, never()).sendOverdueAlert(anyString(), anyString(), anyDouble(), anyDouble(), anyDouble(), any());
    }

    @Test
    void checkOverdueSessions_HikerIsRequester() throws Exception {
        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(List.of(session));
        when(emailService.isConfigured()).thenReturn(true);

        FriendshipEntity f1 = new FriendshipEntity(hiker, friend1, Status.ACCEPTED);
        when(friendshipRepository.findAllByUserAndStatus(1L, Status.ACCEPTED)).thenReturn(List.of(f1));

        overdueAlertService.checkOverdueSessions();

        verify(emailService).sendOverdueAlert(eq("friend1@example.com"), eq("Hiker John"), eq(47.5), eq(19.0), eq(10.0), anyString());
        verify(sessionRepository).save(session);
    }

    @Test
    void checkOverdueSessions_HikerIsAddressee() throws Exception {
        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(List.of(session));
        when(emailService.isConfigured()).thenReturn(true);

        FriendshipEntity f2 = new FriendshipEntity(friend2, hiker, Status.ACCEPTED);
        when(friendshipRepository.findAllByUserAndStatus(1L, Status.ACCEPTED)).thenReturn(List.of(f2));

        overdueAlertService.checkOverdueSessions();

        verify(emailService).sendOverdueAlert(eq("friend2@example.com"), eq("Hiker John"), eq(47.5), eq(19.0), eq(10.0), anyString());
        verify(sessionRepository).save(session);
    }

    @Test
    void checkOverdueSessions_NullExpectedReturnAndNullAccuracy() throws Exception {
        session.setExpectedReturn(null);
        session.setLastAccuracyM(null);

        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(List.of(session));
        when(emailService.isConfigured()).thenReturn(true);

        FriendshipEntity f1 = new FriendshipEntity(hiker, friend1, Status.ACCEPTED);
        when(friendshipRepository.findAllByUserAndStatus(1L, Status.ACCEPTED)).thenReturn(List.of(f1));

        overdueAlertService.checkOverdueSessions();

        verify(emailService).sendOverdueAlert(eq("friend1@example.com"), eq("Hiker John"), eq(47.5), eq(19.0), eq(0.0), isNull());
        verify(sessionRepository).save(session);
    }

    @Test
    void checkOverdueSessions_EmailSendingException_ContinuesLoop() throws Exception {
        when(sessionRepository.findByActiveTrueAndOverdueAlertSentFalseAndExpectedReturnBefore(any(Instant.class)))
            .thenReturn(List.of(session));
        when(emailService.isConfigured()).thenReturn(true);

        FriendshipEntity f1 = new FriendshipEntity(hiker, friend1, Status.ACCEPTED);
        FriendshipEntity f2 = new FriendshipEntity(hiker, friend2, Status.ACCEPTED);
        when(friendshipRepository.findAllByUserAndStatus(1L, Status.ACCEPTED)).thenReturn(List.of(f1, f2));

        doThrow(new RuntimeException("API error")).when(emailService)
            .sendOverdueAlert(eq("friend1@example.com"), anyString(), anyDouble(), anyDouble(), anyDouble(), any());

        overdueAlertService.checkOverdueSessions();

        verify(emailService).sendOverdueAlert(eq("friend1@example.com"), anyString(), anyDouble(), anyDouble(), anyDouble(), any());
        verify(emailService).sendOverdueAlert(eq("friend2@example.com"), anyString(), anyDouble(), anyDouble(), anyDouble(), any());
        verify(sessionRepository).save(session);
    }
}
