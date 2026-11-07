import type { BlockDefinition } from "../types.js";
import { buttonBlock } from "./button.js";
import { columnsBlock } from "./columns.js";
import { headingBlock } from "./heading.js";
import { heroBlock } from "./hero.js";
import { imageBlock } from "./image.js";
import { richTextBlock } from "./rich-text.js";
import { sectionBlock } from "./section.js";
import { latestResultsBlock, upcomingMatchesBlock } from "./sport/matches.js";
import { teamGridBlock, teamProfileBlock, trainingScheduleBlock } from "./sport/teams.js";
import { venuesBlock } from "./sport/venues.js";

export type { ButtonProps } from "./button.js";
export type { ColumnsProps } from "./columns.js";
export type { HeadingProps } from "./heading.js";
export type { HeroProps } from "./hero.js";
export type { ImageProps } from "./image.js";
export type { RichTextProps } from "./rich-text.js";
export type { SectionProps } from "./section.js";
export type { MatchesProps } from "./sport/matches.js";
export type {
  TeamGridProps,
  TeamProfileData,
  TeamProfileProps,
  TrainingScheduleProps,
} from "./sport/teams.js";
export type { VenuesProps } from "./sport/venues.js";
export {
  buttonBlock,
  columnsBlock,
  headingBlock,
  heroBlock,
  imageBlock,
  latestResultsBlock,
  richTextBlock,
  sectionBlock,
  teamGridBlock,
  teamProfileBlock,
  trainingScheduleBlock,
  upcomingMatchesBlock,
  venuesBlock,
};

/** Blocks of the core, in the order the editor offers them. */
export const coreBlocks: readonly BlockDefinition[] = [
  heroBlock,
  sectionBlock,
  columnsBlock,
  headingBlock,
  richTextBlock,
  imageBlock,
  buttonBlock,
  upcomingMatchesBlock,
  latestResultsBlock,
  teamGridBlock,
  teamProfileBlock,
  trainingScheduleBlock,
  venuesBlock,
];
