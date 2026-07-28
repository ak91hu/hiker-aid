package com.hikerAid.controller;

import com.hikerAid.entity.ActivityEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.model.GpxData;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.GpxParserService;
import com.hikerAid.service.RouteAnalysisService;
import com.hikerAid.service.RouteAnalysisService.PaceCalibrationSample;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.io.InputStream;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class UserControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private ActivityRepository activityRepository;

    @Mock
    private GpxParserService gpxParser;

    @Mock
    private RouteAnalysisService routeAnalysis;

    @Mock
    private OAuth2User mockPrincipal;

    private UserEntity user;

    @BeforeEach
    void setUp() {
        user = new UserEntity("google-123", "user@example.com", "Hiker Jane", "pic.jpg");
        user.setId(1L);
    }

    private MockMvc buildMockMvc(OAuth2User principal) {
        UserController controller = new UserController(userRepository, activityRepository, gpxParser, routeAnalysis);
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

    private ActivityEntity createActivity(UserEntity u, String name, double distKm, double gainM, long movingMin) {
        ActivityEntity act = new ActivityEntity();
        act.setUser(u);
        act.setName(name);
        act.setGpxData("<gpx/>");
        act.setDistanceKm(distKm);
        act.setElevationGainM(gainM);
        act.setMovingTimeMinutes(movingMin);
        return act;
    }

    @Test
    void currentUser_Unauthenticated_ReturnsLoggedInFalse() throws Exception {
        MockMvc mvc = buildMockMvc(null);
        mvc.perform(get("/api/user"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.loggedIn").value(false));
    }

    @Test
    void currentUser_Authenticated_ReturnsUserMap() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(mockPrincipal.getAttribute("name")).thenReturn("Hiker Jane");
        when(mockPrincipal.getAttribute("email")).thenReturn("user@example.com");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/user"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.loggedIn").value(true))
            .andExpect(jsonPath("$.name").value("Hiker Jane"))
            .andExpect(jsonPath("$.email").value("user@example.com"))
            .andExpect(jsonPath("$.admin").value(false));
    }

    @Test
    void userStats_Unauthenticated_Returns401() throws Exception {
        MockMvc mvc = buildMockMvc(null);
        mvc.perform(get("/api/user/stats"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void userStats_WithActivities_CalculatesAggregatesLongestAndMostGain() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        ActivityEntity act1 = createActivity(user, "Hike 1", 10.0, 500.0, 120L);
        ActivityEntity act2 = createActivity(user, "Hike 2", 15.0, 300.0, 180L);
        when(activityRepository.findByUserIdOrderByRecordedAtDesc(1L)).thenReturn(List.of(act1, act2));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/user/stats"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalKm").value(25.0))
            .andExpect(jsonPath("$.totalGainM").value(800.0))
            .andExpect(jsonPath("$.totalActivities").value(2))
            .andExpect(jsonPath("$.longestKm").value(15.0))
            .andExpect(jsonPath("$.mostGainM").value(500.0));
    }

    @Test
    void userPace_LessThan3Samples_ReturnsCalibratedFalse() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        ActivityEntity act1 = createActivity(user, "Hike 1", 10.0, 500.0, 120L);
        when(activityRepository.findByUserIdOrderByRecordedAtDesc(1L)).thenReturn(List.of(act1));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/user/pace"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.calibrated").value(false))
            .andExpect(jsonPath("$.samples").value(0))
            .andExpect(jsonPath("$.needed").value(3));
    }

    @Test
    void userPace_ThreeOrMoreSamples_ReturnsCalibratedTrueAndPaceFactor() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        ActivityEntity act1 = createActivity(user, "Hike 1", 10.0, 500.0, 120L);
        ActivityEntity act2 = createActivity(user, "Hike 2", 12.0, 600.0, 140L);
        ActivityEntity act3 = createActivity(user, "Hike 3", 8.0, 300.0, 90L);
        when(activityRepository.findByUserIdOrderByRecordedAtDesc(1L)).thenReturn(List.of(act1, act2, act3));

        GpxData fakeGpx = new GpxData("Test", null, null, List.of(), List.of());
        when(gpxParser.parse(any(InputStream.class))).thenReturn(fakeGpx);

        PaceCalibrationSample validSample = new PaceCalibrationSample(true, 10.0, 100L, 110.0);
        when(routeAnalysis.paceCalibrationSample(fakeGpx)).thenReturn(validSample);

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/user/pace"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.calibrated").value(true))
            .andExpect(jsonPath("$.samples").value(3))
            .andExpect(jsonPath("$.paceFactor").isNumber());
    }
}
