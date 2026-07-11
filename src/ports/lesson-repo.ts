import type { Lesson, LessonFile, PerformanceRecord } from "../domain/schemas/lesson.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface ListLessonsOptions {
  role?: string | null;
  pinned?: boolean | null;
  tag?: string | null;
  limit?: number;
}

export interface LessonRepo {
  load(): Promise<Result<LessonFile, LoadError>>;
  save(file: LessonFile): Promise<void>;
  listLessons(opts?: ListLessonsOptions): Promise<Lesson[]>;
  addLesson(lesson: Lesson): Promise<void>;
  pinLesson(id: string): Promise<boolean>;
  unpinLesson(id: string): Promise<boolean>;
  appendPerformance(perf: PerformanceRecord): Promise<void>;
  recentPerformance(limit?: number): Promise<PerformanceRecord[]>;
}
