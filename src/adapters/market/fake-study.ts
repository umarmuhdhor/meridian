import type { StudyClient } from "../../ports/study-client.js";
import type { StudyResult, TopLpersResult } from "../../domain/schemas/study.js";

export interface FakeStudyOptions {
  top?: TopLpersResult;
  study?: StudyResult;
}

/** In-memory study source for dry-run / tests. Empty by default. */
export function createFakeStudy(opts: FakeStudyOptions = {}): StudyClient {
  return {
    async getTopLpers(): Promise<TopLpersResult> {
      return opts.top ?? { lpers: [], count: 0 };
    },
    async studyTopLpers(): Promise<StudyResult> {
      return opts.study ?? { lpers: [], summary: null, patterns: [] };
    },
  };
}
