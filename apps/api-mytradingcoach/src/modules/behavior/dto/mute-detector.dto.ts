import { IsIn } from 'class-validator';
import { BEHAVIOR_MUTABLE_DETECTORS, type BehaviorMutableDetector } from '@mtc/shared';

/** `POST /behavior/mutes` : détecteur à couper (le bouclier annonces a son propre réglage). */
export class MuteDetectorDto {
  @IsIn(BEHAVIOR_MUTABLE_DETECTORS)
  detector!: BehaviorMutableDetector;
}
