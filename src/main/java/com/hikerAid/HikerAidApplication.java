package com.hikerAid;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class HikerAidApplication {
    public static void main(String[] args) {
        SpringApplication.run(HikerAidApplication.class, args);
    }
}
