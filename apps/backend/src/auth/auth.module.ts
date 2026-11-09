import { BrowserAuthController } from "./browser-auth.controller";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, BrowserAuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
