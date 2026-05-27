package com.hikerAid.service;

import com.hikerAid.entity.FriendInviteEntity;
import com.hikerAid.entity.FriendshipEntity;
import com.hikerAid.entity.UserEntity;
import com.hikerAid.repository.FriendInviteRepository;
import com.hikerAid.repository.FriendshipRepository;
import com.hikerAid.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CustomOAuth2UserService extends DefaultOAuth2UserService {

    private final UserRepository userRepository;
    private final FriendInviteRepository friendInviteRepository;
    private final FriendshipRepository friendshipRepository;

    @Value("${hikerAid.admin-email:}")
    private String adminEmail;

    public CustomOAuth2UserService(UserRepository userRepository,
                                   FriendInviteRepository friendInviteRepository,
                                   FriendshipRepository friendshipRepository) {
        this.userRepository = userRepository;
        this.friendInviteRepository = friendInviteRepository;
        this.friendshipRepository = friendshipRepository;
    }

    @Override
    public OAuth2User loadUser(OAuth2UserRequest request) throws OAuth2AuthenticationException {
        OAuth2User oauthUser = super.loadUser(request);

        String googleId = oauthUser.getAttribute("sub");
        String email = oauthUser.getAttribute("email");
        String name = oauthUser.getAttribute("name");
        String avatar = oauthUser.getAttribute("picture");

        boolean isNew = false;
        UserEntity user = userRepository.findByGoogleId(googleId).orElse(null);
        if (user == null) {
            user = new UserEntity(googleId, email, name, avatar);
            isNew = true;
        } else {
            user.setEmail(email);
            user.setName(name);
            user.setAvatarUrl(avatar);
        }

        if (adminEmail != null && !adminEmail.isBlank() && adminEmail.equalsIgnoreCase(email)) {
            user.setAdmin(true);
        }

        userRepository.save(user);

        if (isNew) {
            convertPendingInvites(user);
        }

        return oauthUser;
    }

    private void convertPendingInvites(UserEntity newUser) {
        List<FriendInviteEntity> invites = friendInviteRepository.findByInviteeEmailIgnoreCase(newUser.getEmail());
        for (FriendInviteEntity invite : invites) {
            FriendshipEntity friendship = new FriendshipEntity(
                    invite.getInviter(), newUser, FriendshipEntity.Status.ACCEPTED);
            friendshipRepository.save(friendship);
            friendInviteRepository.delete(invite);
        }
    }
}
