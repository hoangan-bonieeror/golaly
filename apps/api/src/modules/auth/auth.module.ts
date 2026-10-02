import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.controller";
import { AuthController, AuthService } from "./auth";
import { GoogleAuthController, GoogleAuthService, GoogleClient } from "./google";

@Module({
  imports: [UsersModule],
  controllers: [AuthController, GoogleAuthController],
  providers: [AuthService, GoogleClient, GoogleAuthService],
  exports: [AuthService],
})
export class AuthModule {}
