import { initialize, type BugDropBrowserOptions, type BugDropController } from './loader.js';

export { BugDropController } from './loader.js';
export type {
  BugDropBrowserOptions,
  BugDropTheme,
  BugDropPosition,
  SubmissionTokenProvider,
} from './loader.js';

export class BugDrop {
  static init(options: BugDropBrowserOptions): BugDropController {
    return initialize(options, 'classic');
  }
}
