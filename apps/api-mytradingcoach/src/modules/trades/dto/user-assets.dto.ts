import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveUserAssetsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  assets!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  favoriteAsset?: string | null;
}

export class SetFavoriteAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  asset?: string | null;
}
