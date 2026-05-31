package com.hikerAid.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@Controller
public class HomeController {

    @GetMapping("/")
    public String index() {
        return "index";
    }

    @GetMapping("/route/{token}")
    public String sharedRoute(@PathVariable String token) {
        return "index";
    }

    @GetMapping("/live/{token}")
    public String livePage(@PathVariable String token) {
        return "index";
    }
}
