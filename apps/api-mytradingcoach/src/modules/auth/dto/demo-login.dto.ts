import { IsBoolean, IsOptional } from 'class-validator';

/** POST /auth/demo-login : `internal` = navigateur en mode interne (`?internal=1`), ouverture non comptée. */
export class DemoLoginDto {
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
