package com.hikerAid.controller;

import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.ActivityRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.EmailService;
import com.hikerAid.service.GeminiService;
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
import org.springframework.web.servlet.view.InternalResourceViewResolver;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class AdminControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private ActivityRepository activityRepository;

    @Mock
    private GeminiService geminiService;

    @Mock
    private EmailService emailService;

    @Mock
    private OAuth2User mockPrincipal;

    private UserEntity adminUser;
    private UserEntity regularUser;

    @BeforeEach
    void setUp() {
        adminUser = new UserEntity("google-admin", "admin@example.com", "Admin User", "admin.jpg");
        adminUser.setId(1L);
        adminUser.setAdmin(true);

        regularUser = new UserEntity("google-reg", "reg@example.com", "Regular User", "reg.jpg");
        regularUser.setId(2L);
        regularUser.setAdmin(false);
    }

    private MockMvc buildMockMvc(OAuth2User principal) {
        AdminController controller = new AdminController(userRepository, activityRepository, geminiService, emailService);
        InternalResourceViewResolver viewResolver = new InternalResourceViewResolver();
        viewResolver.setPrefix("/templates/");
        viewResolver.setSuffix(".html");

        return MockMvcBuilders.standaloneSetup(controller)
            .setViewResolvers(viewResolver)
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
    void adminPage_NonAdmin_RedirectsToHome() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-reg");
        when(userRepository.findByGoogleId("google-reg")).thenReturn(Optional.of(regularUser));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/admin"))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/"));
    }

    @Test
    void adminPage_Admin_ReturnsAdminViewName() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/admin"))
            .andExpect(status().isOk())
            .andExpect(view().name("admin"));
    }

    @Test
    void stats_NonAdmin_Returns403() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-reg");
        when(userRepository.findByGoogleId("google-reg")).thenReturn(Optional.of(regularUser));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/admin/stats"))
            .andExpect(status().isForbidden());
    }

    @Test
    void stats_Admin_ReturnsSystemMetrics() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));
        when(userRepository.count()).thenReturn(10L);
        when(activityRepository.count()).thenReturn(50L);

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/admin/stats"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalUsers").value(10))
            .andExpect(jsonPath("$.totalActivities").value(50));
    }

    @Test
    void users_Admin_ReturnsUserListWithActivityCounts() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));
        when(userRepository.findAll()).thenReturn(List.of(adminUser, regularUser));
        when(activityRepository.countByUserId(1L)).thenReturn(5L);
        when(activityRepository.countByUserId(2L)).thenReturn(2L);

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/admin/users"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$[0].email").value("admin@example.com"))
            .andExpect(jsonPath("$[1].activityCount").value(2));
    }

    @Test
    void deleteUser_AdminUser_Returns400() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));
        when(userRepository.findById(1L)).thenReturn(Optional.of(adminUser));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(delete("/api/admin/users/1"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Cannot delete admin user"));
    }

    @Test
    void deleteUser_RegularUser_DeletesActivitiesAndUser() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));
        when(userRepository.findById(2L)).thenReturn(Optional.of(regularUser));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(delete("/api/admin/users/2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));

        verify(activityRepository).deleteAllByUserId(2L);
        verify(userRepository).delete(regularUser);
    }

    @Test
    void testAi_Admin_ReturnsLatencyAndResponse() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-admin");
        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.of(adminUser));
        when(geminiService.isAvailable()).thenReturn(true);
        when(geminiService.testConnection()).thenReturn("gemini-2.5-flash responded: Pong");

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/admin/test-ai"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.configured").value(true))
            .andExpect(jsonPath("$.response").value("gemini-2.5-flash responded: Pong"));
    }
}
