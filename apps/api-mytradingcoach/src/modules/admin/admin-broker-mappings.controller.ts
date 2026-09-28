import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsvImportService } from '../trades/csv-import.service';
import { BrokerMappingService } from '../trades/broker-mapping.service';
import {
  MAPPING_MIN_PNL_RATIO,
  validateMappingShape,
  type CsvMapping,
} from '../trades/csv-mapping';
import { splitCsvLine } from '../trades/csv-parsers';
import {
  AnalyseSampleDto,
  PreviewMappingDto,
  SaveMappingDto,
  SetMappingEnabledDto,
} from './dto/broker-mapping.dto';

/**
 * Registre des brokers, cote admin : `/admin/broker-mappings/*`.
 *
 * Remplace l'ecriture d'un parseur TypeScript par broker. Un utilisateur signale que son
 * export ne passe pas, il l'envoie, un admin colle l'echantillon ici, verifie l'apercu et
 * enregistre : le broker est reconnu pour tout le monde, sans build ni deploiement. C'est
 * cette propriete qui rend le deblocage possible depuis un telephone.
 *
 * Trois etapes, dont une seule coute de l'IA :
 *  - `analyse`  : UN appel modele, ~0,003 $, deduit la fiche depuis l'echantillon ;
 *  - `preview`  : rejoue une fiche corrigee a la main, GRATUIT, autant de fois qu'on veut ;
 *  - `POST /`   : enregistre, apres verification du taux de coherence du P&L.
 */
@Controller('admin/broker-mappings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminBrokerMappingsController {
  constructor(
    private readonly imports: CsvImportService,
    private readonly registry: BrokerMappingService,
  ) {}

  @Get()
  list() {
    return this.registry.list();
  }

  @Post('analyse')
  async analyse(@Body() dto: AnalyseSampleDto) {
    const res = await this.imports.analyseSampleForAdmin(dto.sample);
    if (!res) {
      throw new BadRequestException(
        "Échantillon trop court : il faut l'en-tête et au moins une ligne de trade.",
      );
    }
    if (!res.mapping) {
      throw new BadRequestException(
        "Le modèle n'a pas produit de correspondance exploitable pour ce fichier. " +
        'Vérifie que le collage contient bien la ligne d\'en-tête.',
      );
    }
    return res;
  }

  @Post('preview')
  preview(@Body() dto: PreviewMappingDto) {
    const { lignes, mapping } = this.relire(dto);
    return this.imports.previewForAdmin(lignes, mapping);
  }

  @Post()
  async save(
    @CurrentUser() user: { id: string },
    @Body() dto: SaveMappingDto,
  ) {
    const { lignes, mapping } = this.relire(dto);
    const res = this.imports.previewForAdmin(lignes, mapping);

    if (!res.preview.length) {
      throw new BadRequestException(
        "Cette correspondance ne produit aucun trade sur l'échantillon : elle n'est pas enregistrable.",
      );
    }

    // Garde-fou pense pour la validation depuis un telephone : entre deux choses, sur un
    // petit ecran, c'est la qu'on laisse passer une inversion du sens. Le code refuse donc
    // de lui-meme ce qui est douteux, plutot que de compter sur l'attention de l'admin.
    if (res.pnlRatio != null && res.pnlRatio < MAPPING_MIN_PNL_RATIO) {
      throw new BadRequestException(
        `Le signe du P&L ne confirme le sens que sur ${Math.round(res.pnlRatio * 100)} % ` +
        `des lignes (minimum ${Math.round(MAPPING_MIN_PNL_RATIO * 100)} %). ` +
        'Corrige la colonne de sens avant d\'enregistrer.',
      );
    }
    if (res.pnlRatio == null) {
      throw new BadRequestException(
        "Le sens n'est pas vérifiable sur cet échantillon : il manque les prix d'entrée ou " +
        'les P&L. Demande un export contenant le prix d\'entrée.',
      );
    }

    return this.registry.save({
      header: res.mapping ? lignes[0] : lignes[0],
      brokerName: dto.brokerName,
      // La fiche enregistree est celle RETENUE par l'apercu : si le controle a redresse le
      // sens, c'est la version corrigee qui part en base.
      mapping: res.mapping as CsvMapping,
      pnlConfidence: res.pnlRatio,
      validatedById: user.id,
    });
  }

  @Patch(':id/enabled')
  async setEnabled(@Param('id') id: string, @Body() dto: SetMappingEnabledDto) {
    await this.registry.setEnabled(id, dto.enabled);
    return { id, enabled: dto.enabled };
  }

  /**
   * Relit l'echantillon et la fiche envoyes par l'admin. La fiche repasse par la MEME
   * validation de forme que celle du chemin d'import : une correspondance bricolee a la main
   * dans l'interface ne doit pas pouvoir designer une colonne qui n'existe pas.
   */
  private relire(dto: PreviewMappingDto): { lignes: string[]; mapping: CsvMapping } {
    const lignes = dto.sample
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim());
    if (lignes.length < 2) {
      throw new BadRequestException(
        "Échantillon trop court : il faut l'en-tête et au moins une ligne de trade.",
      );
    }
    const sep = dto.mapping['delimiter'];
    const nbColonnes = splitCsvLine(
      lignes[0],
      typeof sep === 'string' && sep.length === 1 ? sep : ',',
    ).length;

    const mapping = validateMappingShape(dto.mapping, nbColonnes);
    if (!mapping) {
      throw new BadRequestException(
        'Correspondance invalide : une colonne désignée sort du nombre de colonnes du fichier, ' +
        'ou un champ obligatoire manque.',
      );
    }
    return { lignes, mapping };
  }
}
