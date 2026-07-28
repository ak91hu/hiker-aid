package com.hikerAid.controller;

import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.FriendshipEntity.Status;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendInviteRepository;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.UserRepository;
import com.hikerAid.service.EmailService;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class FriendControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private FriendInviteRepository friendInviteRepository;

    @Mock
    private EmailService emailService;

    @Mock
    private OAuth2User mockPrincipal;

    private UserEntity user;
    private UserEntity friendUser;

    @BeforeEach
    void setUp() {
        user = new UserEntity("google-123", "user@example.com", "User One", "pic.jpg");
        user.setId(1L);

        friendUser = new UserEntity("google-456", "friend@example.com", "Friend Two", "pic2.jpg");
        friendUser.setId(2L);
    }

    private MockMvc buildMockMvc(OAuth2User principal) {
        FriendController controller = new FriendController(userRepository, friendshipRepository, friendInviteRepository, emailService);
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
    void listFriends_Unauthenticated_Returns401() throws Exception {
        MockMvc mvc = buildMockMvc(null);
        mvc.perform(get("/api/friends"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void listFriends_Authenticated_ReturnsFriendsIncomingAndPendingInvites() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        FriendshipEntity accepted = new FriendshipEntity(user, friendUser, Status.ACCEPTED);
        accepted.setId(10L);
        when(friendshipRepository.findAllByUserAndStatus(1L, Status.ACCEPTED)).thenReturn(List.of(accepted));
        when(friendshipRepository.findPendingForUser(1L)).thenReturn(List.of());
        when(friendInviteRepository.findAll()).thenReturn(List.of());

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(get("/api/friends"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.friends").isArray())
            .andExpect(jsonPath("$.friends[0].email").value("friend@example.com"))
            .andExpect(jsonPath("$.incoming").isArray())
            .andExpect(jsonPath("$.pendingInvites").isArray());
    }

    @Test
    void addFriend_MissingEmail_Returns400() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/add")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Email is required"));
    }

    @Test
    void addFriend_SelfEmail_Returns400() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/add")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"USER@EXAMPLE.COM\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("You cannot add yourself"));
    }

    @Test
    void addFriend_ExistingUser_CreatesPendingFriendship() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));
        when(userRepository.findByEmailIgnoreCase("friend@example.com")).thenReturn(Optional.of(friendUser));
        when(friendshipRepository.findBetweenUsers(1L, 2L)).thenReturn(Optional.empty());

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/add")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"friend@example.com\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("pending"));

        verify(friendshipRepository).save(any(FriendshipEntity.class));
    }

    @Test
    void addFriend_NewUser_EmailNotConfigured_Returns503() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));
        when(userRepository.findByEmailIgnoreCase("newperson@example.com")).thenReturn(Optional.empty());
        when(friendInviteRepository.existsByInviterIdAndInviteeEmailIgnoreCase(1L, "newperson@example.com")).thenReturn(false);
        when(emailService.isConfigured()).thenReturn(false);

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/add")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"newperson@example.com\"}"))
            .andExpect(status().isServiceUnavailable());
    }

    @Test
    void acceptFriend_Success_UpdatesStatusToAccepted() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-456");
        when(userRepository.findByGoogleId("google-456")).thenReturn(Optional.of(friendUser));

        FriendshipEntity pending = new FriendshipEntity(user, friendUser, Status.PENDING);
        pending.setId(10L);
        when(friendshipRepository.findById(10L)).thenReturn(Optional.of(pending));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/accept/10"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("accepted"));

        verify(friendshipRepository).save(pending);
    }

    @Test
    void removeFriend_NotFound_Returns404() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));
        when(friendshipRepository.findById(999L)).thenReturn(Optional.empty());

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(delete("/api/friends/999"))
            .andExpect(status().isNotFound());
    }

    @Test
    void sendEmergency_MissingCoordinates_Returns400() throws Exception {
        when(mockPrincipal.getAttribute("sub")).thenReturn("google-123");
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(user));

        MockMvc mvc = buildMockMvc(mockPrincipal);
        mvc.perform(post("/api/friends/emergency")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest());
    }
}
