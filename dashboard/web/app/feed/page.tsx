"use client";

import { LessonEditor } from "@/components/LessonEditor";
import { StrategyEditor } from "@/components/StrategyEditor";

export default function FeedPage() {
  return (
    <div className="flex flex-col gap-8">
      <LessonEditor />
      <StrategyEditor />
    </div>
  );
}
