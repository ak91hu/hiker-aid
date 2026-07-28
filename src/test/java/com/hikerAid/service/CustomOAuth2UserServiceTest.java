package com.hikerAid.service;

import com.hikerAid.entity.FriendInviteEntity;
import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendInviteRepository;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CustomOAuth2UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private FriendInviteRepository friendInviteRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private OAuth2User oauth2User;

    @Mock
    private OAuth2UserRequest userRequest;

    private CustomOAuth2UserService customOAuth2UserService;

    @BeforeEach
    void setUp() {
        customOAuth2UserService = spy(new CustomOAuth2UserService(userRepository, friendInviteRepository, friendshipRepository));
        ReflectionTestUtils.setField(customOAuth2UserService, "adminEmail", "admin@hikeraid.com");
    }

    @Test
    void loadUser_ExistingUser_UpdatesProfileAndSaves() {
        doReturn(oauth2User).when(customOAuth2UserService).fetchOAuth2User(any());

        when(oauth2User.getAttribute("sub")).thenReturn("google-123");
        when(oauth2User.getAttribute("email")).thenReturn("user@example.com");
        when(oauth2User.getAttribute("name")).thenReturn("Updated User");
        when(oauth2User.getAttribute("picture")).thenReturn("newpic.jpg");

        UserEntity existing = new UserEntity("google-123", "old@example.com", "Old Name", "oldpic.jpg");
        existing.setId(1L);
        when(userRepository.findByGoogleId("google-123")).thenReturn(Optional.of(existing));
        when(userRepository.save(any(UserEntity.class))).thenAnswer(i -> i.getArgument(0));

        OAuth2User result = customOAuth2UserService.loadUser(userRequest);

        assertNotNull(result);
        verify(userRepository).save(existing);
        assertEquals("user@example.com", existing.getEmail());
        assertEquals("Updated User", existing.getName());
        assertEquals("newpic.jpg", existing.getAvatarUrl());
        verify(friendInviteRepository, never()).findByInviteeEmailIgnoreCase(anyString());
    }

    @Test
    void loadUser_NewUser_CreatesUserAndConvertsPendingInvites() {
        doReturn(oauth2User).when(customOAuth2UserService).fetchOAuth2User(any());

        when(oauth2User.getAttribute("sub")).thenReturn("google-new");
        when(oauth2User.getAttribute("email")).thenReturn("newuser@example.com");
        when(oauth2User.getAttribute("name")).thenReturn("New User");
        when(oauth2User.getAttribute("picture")).thenReturn("pic.jpg");

        when(userRepository.findByGoogleId("google-new")).thenReturn(Optional.empty());
        when(userRepository.save(any(UserEntity.class))).thenAnswer(i -> {
            UserEntity u = i.getArgument(0);
            if (u.getId() == null) u.setId(99L);
            return u;
        });

        UserEntity inviter = new UserEntity("google-inviter", "inviter@example.com", "Inviter", "inv.jpg");
        inviter.setId(2L);
        FriendInviteEntity invite = new FriendInviteEntity(inviter, "newuser@example.com");
        when(friendInviteRepository.findByInviteeEmailIgnoreCase("newuser@example.com")).thenReturn(List.of(invite));

        OAuth2User result = customOAuth2UserService.loadUser(userRequest);

        assertNotNull(result);
        ArgumentCaptor<UserEntity> userCaptor = ArgumentCaptor.forClass(UserEntity.class);
        verify(userRepository).save(userCaptor.capture());
        UserEntity savedUser = userCaptor.getValue();
        assertEquals("newuser@example.com", savedUser.getEmail());
        assertFalse(savedUser.isAdmin());

        verify(friendshipRepository).save(any(FriendshipEntity.class));
        verify(friendInviteRepository).delete(invite);
    }

    @Test
    void loadUser_NewUser_MatchesAdminEmail_SetsAdminTrue() {
        doReturn(oauth2User).when(customOAuth2UserService).fetchOAuth2User(any());

        when(oauth2User.getAttribute("sub")).thenReturn("google-admin");
        when(oauth2User.getAttribute("email")).thenReturn("admin@hikeraid.com");
        when(oauth2User.getAttribute("name")).thenReturn("Admin Boss");
        when(oauth2User.getAttribute("picture")).thenReturn("admin.jpg");

        when(userRepository.findByGoogleId("google-admin")).thenReturn(Optional.empty());
        when(userRepository.save(any(UserEntity.class))).thenAnswer(i -> i.getArgument(0));
        when(friendInviteRepository.findByInviteeEmailIgnoreCase("admin@hikeraid.com")).thenReturn(List.of());

        OAuth2User result = customOAuth2UserService.loadUser(userRequest);

        assertNotNull(result);
        ArgumentCaptor<UserEntity> userCaptor = ArgumentCaptor.forClass(UserEntity.class);
        verify(userRepository).save(userCaptor.capture());
        assertTrue(userCaptor.getValue().isAdmin());
    }
}
