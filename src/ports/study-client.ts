import type { StudyResult, TopLpersResult } from "../domain/schemas/study.js";

/** Agent Meridian top-LP study source. Non-throwing: returns empty results on failure. */
export interface StudyClient {
  getTopLpers(limit?: number): Promise<TopLpersResult>;
  studyTopLpers(): Promise<StudyResult>;
}
