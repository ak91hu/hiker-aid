package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.TrackingSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.Optional;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class PublicControllerTest {

    @Mock
    private ActivityRepository activityRepository;

    @Mock
    private TrackingSessionRepository sessionRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        PublicController controller = new PublicController(activityRepository, sessionRepository);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void sharedRoute_InvalidToken_Returns404() throws Exception {
        when(activityRepository.findByShareToken("invalid-token")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/public/route/invalid-token"))
            .andExpect(status().isNotFound());
    }

    @Test
    void sharedRoute_ValidToken_ReturnsNameAndGpxData() throws Exception {
        UserEntity user = new UserEntity("google-1", "user@example.com", "Hiker", "pic.jpg");
        ActivityEntity activity = new ActivityEntity();
        activity.setUser(user);
        activity.setName("Shared Hike");
        activity.setGpxData("<gpx/>");
        activity.setDistanceKm(12.0);
        activity.setElevationGainM(400.0);
        activity.setMovingTimeMinutes(150L);
        activity.setShareToken("route123");

        when(activityRepository.findByShareToken("route123")).thenReturn(Optional.of(activity));

        mockMvc.perform(get("/api/public/route/route123"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Shared Hike"))
            .andExpect(jsonPath("$.gpxData").value("<gpx/>"));
    }

    @Test
    void liveTrack_InvalidToken_Returns404() throws Exception {
        when(sessionRepository.findByToken("invalid-track")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/public/track/invalid-track"))
            .andExpect(status().isNotFound());
    }

    @Test
    void liveTrack_ValidToken_WithoutFix_ReturnsHasFixFalse() throws Exception {
        UserEntity user = new UserEntity("google-1", "user@example.com", "Hiker One", "pic.jpg");
        TrackingSessionEntity session = new TrackingSessionEntity();
        session.setToken("track123");
        session.setUser(user);
        session.setActive(true);

        when(sessionRepository.findByToken("track123")).thenReturn(Optional.of(session));

        mockMvc.perform(get("/api/public/track/track123"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.hikerName").value("Hiker"))
            .andExpect(jsonPath("$.active").value(true))
            .andExpect(jsonPath("$.hasFix").value(false));
    }

    @Test
    void liveTrack_ValidToken_WithFix_ReturnsFirstNameAndCoordinates() throws Exception {
        UserEntity user = new UserEntity("google-1", "user@example.com", "Hiker One", "pic.jpg");
        TrackingSessionEntity session = new TrackingSessionEntity();
        session.setToken("track123");
        session.setUser(user);
        session.setActive(true);
        session.setLastLat(47.5);
        session.setLastLon(19.0);
        session.setLastAccuracyM(10.0);
        session.setLastUpdate(Instant.now());

        when(sessionRepository.findByToken("track123")).thenReturn(Optional.of(session));

        mockMvc.perform(get("/api/public/track/track123"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.hikerName").value("Hiker"))
            .andExpect(jsonPath("$.active").value(true))
            .andExpect(jsonPath("$.hasFix").value(true))
            .andExpect(jsonPath("$.lat").value(47.5))
            .andExpect(jsonPath("$.lon").value(19.0));
    }
}
