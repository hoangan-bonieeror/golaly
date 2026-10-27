import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.controller";
import { AppAuthController } from "./app-auth";
import { AppleClient } from "./apple";
import { AuthController, AuthService } from "./auth";
import { BreachedPasswords } from "./breached";
import { GoogleAuthController, GoogleAuthService, GoogleClient } from "./google";

@Module({
  imports: [UsersModule],
  controllers: [AuthController, GoogleAuthController, AppAuthController],
  providers: [AuthService, GoogleClient, GoogleAuthService, AppleClient, BreachedPasswords],
  exports: [AuthService],
})
export class AuthModule {}
