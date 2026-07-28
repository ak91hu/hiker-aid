package com.hikerAid.controller;

import com.hikerAid.entity.TrackingSessionEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.TrackingSessionRepository;
import com.hikerAid.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class TrackingControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private TrackingSessionRepository sessionRepository;

    @Mock
    private OAuth2User mockPrincipal;

    private UserEntity user;

    @BeforeEach
    void setUp() {
        user = new UserEntity("google-123", "user@example.com", "Hiker One", "pic.jpg");
        user.setId(1L);
    }

    private MockMvc buildMockMvc(OAuth2User principal) {
        TrackingController controller = new TrackingController(userRepository, sessionRepository);
        return MockMvcBuilders.standaloneSetup(controller)
            .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
                @Override
                public boolean supportsParameter(MethodParameter parameter) {
                    return parameter.hasParameterAnnotation(AuthenticationPrincipal.class)
                        || parameter.getParameterType().isAssignableFrom(OAuth2User.class);
                }

                @Override
                public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                              NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
                    return principal;
                }
            })
            .build();
    }

    @Test
    void start_Unauthenticated_Returns401() throws Exception {
        MockMvc mvc = buildMockMvc(null);
        mvc.perform(post("/api/track/start"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void start_DeactivatesPriorSessions_CreatesNewSession_ReturnsTokenAndUrl() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        TrackingSessionEntity oldSession = new TrackingSessionEntity();
        oldSession.setActive(true);
        when(sessionRepository.findByUserIdAndActiveTrue(1L)).thenReturn(List.of(oldSession));
        when(sessionRepository.save(any(TrackingSessionEntity.class))).thenAnswer(i -> i.getArgument(0));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/track/start")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"routeName\":\"Mountain Trail\",\"expectedReturn\":\"2026-07-28T18:00:00Z\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").isString())
            .andExpect(jsonPath("$.url").isString());

        assertFalse(oldSession.isActive());
        verify(sessionRepository, times(2)).save(any(TrackingSessionEntity.class));
    }

    @Test
    void ping_SessionNotFound_Returns404() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));
        when(sessionRepository.findByToken("bad-token")).thenReturn(Optional.empty());

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/track/bad-token/ping")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"latitude\":47.5,\"longitude\":19.0}"))
            .andExpect(status().isNotFound());
    }

    @Test
    void ping_InactiveSession_Returns400() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        TrackingSessionEntity session = new TrackingSessionEntity();
        session.setUser(user);
        session.setActive(false);
        when(sessionRepository.findByToken("tok123")).thenReturn(Optional.of(session));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/track/tok123/ping")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"latitude\":47.5,\"longitude\":19.0}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Session ended"));
    }

    @Test
    void ping_ValidCoordinates_UpdatesLocationAndTimestamp() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        TrackingSessionEntity session = new TrackingSessionEntity();
        session.setUser(user);
        session.setActive(true);
        when(sessionRepository.findByToken("tok123")).thenReturn(Optional.of(session));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/track/tok123/ping")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"latitude\":47.5,\"longitude\":19.0,\"accuracy\":12.5}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true));

        assertEquals(47.5, session.getLastLat(), 0.0001);
        assertEquals(19.0, session.getLastLon(), 0.0001);
        assertEquals(12.5, session.getLastAccuracyM(), 0.0001);
        assertNotNull(session.getLastUpdate());
        verify(sessionRepository).save(session);
    }

    @Test
    void stop_ValidSession_DeactivatesSession() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        TrackingSessionEntity session = new TrackingSessionEntity();
        session.setUser(user);
        session.setActive(true);
        when(sessionRepository.findByToken("tok123")).thenReturn(Optional.of(session));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/track/tok123/stop"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stopped").value(true));

        assertFalse(session.isActive());
        verify(sessionRepository).save(session);
    }
}
