import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.controller";
import { AuthController, AuthService } from "./auth";
import { BreachedPasswords } from "./breached";
import { GoogleAuthController, GoogleAuthService, GoogleClient } from "./google";

@Module({
  imports: [UsersModule],
  controllers: [AuthController, GoogleAuthController],
  providers: [AuthService, GoogleClient, GoogleAuthService, BreachedPasswords],
  exports: [AuthService],
})
export class AuthModule {}
